import { describe, expect, it, vi } from 'vitest';
import type {
  FeedFetchResult,
  FeedItem,
  Pipeline,
  Report,
  SpeculaConfig,
} from '../types.js';
import { runPipeline, runPipelines } from './index.js';

const config: SpeculaConfig = {
  intervalHours: 1,
  primaryModel: 'primary-model',
  fallbackModel: 'fallback-model',
  thinkingLevel: 'low',
  maxItemsPerRun: 2,
  dedupWindowHours: 48,
  siteRepoPath: './site',
  githubPagesUrl: 'https://example.com/specula',
  feedTitle: 'Specula',
  feedDescription: 'Test feed',
  configUiPort: 3001,
  pipelines: [],
};

function makePipeline(id: string, maxItemsPerRun?: number): Pipeline {
  const pipeline: Pipeline = {
    id,
    label: `Pipeline ${id}`,
    description: `Description for ${id}`,
    feedGroups: [
      { id: `${id}-one`, label: 'Group One', url: 'https://example.com/one.xml' },
      { id: `${id}-two`, label: 'Group Two', url: 'https://example.com/two.xml' },
    ],
  };
  if (maxItemsPerRun !== undefined) {
    pipeline.maxItemsPerRun = maxItemsPerRun;
  }
  return pipeline;
}

function makeItem(
  id: string,
  overrides?: Partial<Omit<FeedItem, 'id'>>,
): FeedItem {
  return {
    id,
    title: overrides?.title ?? `Title ${id}`,
    link: overrides?.link ?? `https://example.com/items/${id}`,
    content: overrides?.content ?? `Content for ${id}`,
    publishedAt: overrides?.publishedAt ?? new Date('2026-04-23T12:00:00.000Z'),
    source: overrides?.source ?? 'Group One',
    sourceUrl: overrides?.sourceUrl ?? 'https://example.com/feed.xml',
  };
}

describe('runPipeline', () => {
  it('orchestrates fetch, parse, dedupe, analyze, and persistence', async () => {
    const pipeline = makePipeline('alpha');
    const now = new Date('2026-04-23T15:45:00.000Z');
    const fetched: FeedFetchResult[] = pipeline.feedGroups.map((group) => ({ group, xml: '<xml />' }));
    const parsed = [
      makeItem('shared', { source: 'Group One', sourceUrl: 'https://example.com/feed-one.xml' }),
      makeItem('shared', { source: 'Group Two', sourceUrl: 'https://example.com/feed-two.xml' }),
      makeItem('fresh-two', { source: 'Group Two', sourceUrl: 'https://example.com/feed-two.xml' }),
    ];

    const fetchFeeds = vi.fn(async () => fetched);
    const parseFeeds = vi.fn(() => parsed);
    const analyze = vi.fn(async (items: FeedItem[]) => ({
      body: `## Lead\n\nAnalyzed ${items.map((item) => item.id).join(', ')}`,
      modelUsed: 'test-model',
      toolCalls: 0,
      steps: 1,
      fellBack: false,
    }));
    const loadSeen = vi.fn(async () => ({ ids: {} }));
    const saveReport = vi.fn(async (report: Report) => `saved/${report.id}.json`);
    const saveSeen = vi.fn(async () => {});

    const result = await runPipeline(
      { ...config, pipelines: [pipeline] },
      pipeline,
      { fetchFeeds, parseFeeds, analyze, loadSeen, saveReport, saveSeen, now: () => now },
    );

    expect(fetchFeeds).toHaveBeenCalledWith(pipeline.feedGroups);
    expect(parseFeeds).toHaveBeenCalledWith(fetched);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]?.[0].map((item: FeedItem) => item.id)).toEqual([
      'shared',
      'fresh-two',
    ]);
    expect(saveReport).toHaveBeenCalledTimes(1);
    expect(saveReport.mock.calls[0]?.[0]).toMatchObject({
      id: 'alpha-2026-04-23-15-45',
      pipelineId: 'alpha',
      pipelineLabel: 'Pipeline alpha',
      generatedAt: '2026-04-23T15:45:00.000Z',
      itemCount: 2,
      modelUsed: 'test-model',
      sources: [
        { label: 'Group One', url: 'https://example.com/feed-one.xml' },
        { label: 'Group Two', url: 'https://example.com/feed-two.xml' },
      ],
      wordCount: 5,
    });
    expect(saveSeen).toHaveBeenCalledWith(
      'alpha',
      {
        ids: {
          shared: '2026-04-23T15:45:00.000Z',
          'fresh-two': '2026-04-23T15:45:00.000Z',
        },
      },
      48,
    );
    expect(result).toMatchObject({
      pipelineId: 'alpha',
      status: 'success',
      fetchedGroups: 2,
      fetchErrors: 0,
      parsedItems: 3,
      dedupedItems: 2,
      unseenItems: 2,
      analyzedItems: 2,
      reportId: 'alpha-2026-04-23-15-45',
      reportPath: 'saved/alpha-2026-04-23-15-45.json',
      modelUsed: 'test-model',
    });
  });

  it('skips when all items were already seen and still persists pruned seen state', async () => {
    const pipeline = makePipeline('beta');
    const seenState = {
      ids: {
        existing: '2026-04-22T12:00:00.000Z',
      },
    };
    const saveSeen = vi.fn(async () => {});
    const analyze = vi.fn();

    const result = await runPipeline(
      { ...config, pipelines: [pipeline] },
      pipeline,
      {
        fetchFeeds: async () => pipeline.feedGroups.map((group) => ({ group, xml: '<xml />' })),
        parseFeeds: () => [makeItem('existing')],
        analyze,
        loadSeen: async () => seenState,
        saveSeen,
        saveReport: async () => 'unused',
      },
    );

    expect(analyze).not.toHaveBeenCalled();
    expect(saveSeen).toHaveBeenCalledWith('beta', seenState, 48);
    expect(result).toMatchObject({
      pipelineId: 'beta',
      status: 'skipped',
      skippedReason: 'no-unseen-items',
      unseenItems: 0,
      analyzedItems: 0,
    });
  });

  it('returns an error result without mutating seen state when analysis fails', async () => {
    const pipeline = makePipeline('gamma');
    const saveSeen = vi.fn(async () => {});

    const result = await runPipeline(
      { ...config, pipelines: [pipeline] },
      pipeline,
      {
        fetchFeeds: async () => pipeline.feedGroups.map((group) => ({ group, xml: '<xml />' })),
        parseFeeds: () => [makeItem('fresh')],
        analyze: async () => {
          throw new Error('model offline');
        },
        loadSeen: async () => ({ ids: {} }),
        saveSeen,
        saveReport: async () => 'unused',
      },
    );

    expect(saveSeen).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      pipelineId: 'gamma',
      status: 'error',
      error: 'model offline',
      unseenItems: 1,
      analyzedItems: 1,
    });
  });
});

describe('runPipelines', () => {
  it('runs the requested subset in sequence and aggregates statuses', async () => {
    const alpha = makePipeline('alpha', 1);
    const beta = makePipeline('beta', 1);
    const cfg: SpeculaConfig = { ...config, pipelines: [alpha, beta] };
    const nowValues = [
      new Date('2026-04-23T09:00:00.000Z'),
      new Date('2026-04-23T09:05:00.000Z'),
      new Date('2026-04-23T09:10:00.000Z'),
      new Date('2026-04-23T09:15:00.000Z'),
    ];

    const result = await runPipelines(
      cfg,
      {
        fetchFeeds: async (groups) => groups.map((group) => ({ group, xml: '<xml />' })),
        parseFeeds: (results) =>
          results[0]?.group.id.startsWith('alpha')
            ? [makeItem('alpha-item')]
            : [makeItem('beta-item')],
        analyze: async (items, pipelineArg) => ({
          body: `Report for ${pipelineArg.id}: ${items[0]?.id ?? 'none'}`,
          modelUsed: `${pipelineArg.id}-model`,
          toolCalls: 0,
          steps: 1,
          fellBack: false,
        }),
        loadSeen: async (pipelineId) =>
          pipelineId === 'beta' ? { ids: { 'beta-item': '2026-04-22T00:00:00.000Z' } } : { ids: {} },
        saveSeen: async () => {},
        saveReport: async (report) => `saved/${report.id}.json`,
        now: () => nowValues.shift() ?? new Date('2026-04-23T09:20:00.000Z'),
      },
      ['alpha', 'beta'],
    );

    expect(result).toMatchObject({
      startedAt: '2026-04-23T09:00:00.000Z',
      finishedAt: '2026-04-23T09:10:00.000Z',
      pipelineCount: 2,
      successCount: 1,
      skippedCount: 1,
      errorCount: 0,
    });
    expect(result.results.map((entry) => [entry.pipelineId, entry.status])).toEqual([
      ['alpha', 'success'],
      ['beta', 'skipped'],
    ]);
  });

  it('throws for unknown pipeline ids', async () => {
    const alpha = makePipeline('alpha');
    await expect(
      runPipelines({ ...config, pipelines: [alpha] }, undefined, ['missing']),
    ).rejects.toThrow(/Unknown pipeline ids: missing/);
  });
});
