import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pipeline, Report, SpeculaConfig } from './types.js';
import { runPipeline } from './pipeline.js';
import { clearStatus, getStatus } from './status/index.js';
import type { PublishResult } from './publisher/index.js';
import type { RunPipelineResult } from './runner/index.js';

const baseConfig: SpeculaConfig = {
  intervalHours: 1,
  primaryModel: 'primary-model',
  fallbackModel: 'fallback-model',
  thinkingLevel: 'low',
  maxItemsPerRun: 10,
  dedupWindowHours: 48,
  siteRepoPath: './site',
  githubPagesUrl: 'https://example.com/specula',
  feedTitle: 'Specula',
  feedDescription: 'Test feed',
  configUiPort: 3001,
  pipelines: [],
};

function makePipeline(id: string): Pipeline {
  return {
    id,
    label: `Pipeline ${id}`,
    description: `Description ${id}`,
    feedGroups: [{ id: `${id}-one`, label: 'Group', url: 'https://example.com/feed.xml' }],
  };
}

function makeReport(pipeline: Pipeline, overrides?: Partial<Report>): Report {
  return {
    id: `${pipeline.id}-2026-04-23-15-45`,
    pipelineId: pipeline.id,
    pipelineLabel: pipeline.label,
    generatedAt: '2026-04-23T15:45:00.000Z',
    itemCount: 2,
    modelUsed: 'test-model',
    sources: [{ label: 'Group', url: 'https://example.com/feed.xml' }],
    body: '## Lead\nBody.',
    wordCount: 3,
    ...overrides,
  };
}

function publishResult(overrides?: Partial<PublishResult>): PublishResult {
  return {
    ok: true,
    ssg: null,
    siteRepoPath: './site',
    hadChanges: true,
    commitSha: 'abc123',
    log: '',
    ...overrides,
  };
}

describe('pipeline.runPipeline', () => {
  beforeEach(() => {
    clearStatus();
  });

  it('orchestrates runner then publisher on success, and updates status', async () => {
    const pipeline = makePipeline('alpha');
    const report = makeReport(pipeline);

    const runnerResult: RunPipelineResult = {
      pipelineId: pipeline.id,
      pipelineLabel: pipeline.label,
      status: 'success',
      fetchedGroups: 1,
      fetchErrors: 0,
      parsedItems: 5,
      dedupedItems: 5,
      unseenItems: 3,
      analyzedItems: 2,
      reportId: report.id,
      reportPath: `/tmp/${report.id}.json`,
      modelUsed: 'test-model',
      report,
    };

    const analyze = vi.fn(async () => ({
      body: report.body,
      modelUsed: report.modelUsed,
      toolCalls: 0,
      steps: 1,
      fellBack: false,
    }));
    const fetchFeeds = vi.fn(async () => [
      { group: pipeline.feedGroups[0]!, xml: '<xml />' },
    ]);
    const parseFeeds = vi.fn(() => [
      {
        id: 'a',
        title: 'A',
        link: 'https://example.com/a',
        content: 'a',
        publishedAt: new Date('2026-04-23T10:00:00.000Z'),
        source: 'Group',
        sourceUrl: 'https://example.com/feed.xml',
      },
      {
        id: 'b',
        title: 'B',
        link: 'https://example.com/b',
        content: 'b',
        publishedAt: new Date('2026-04-23T10:05:00.000Z'),
        source: 'Group',
        sourceUrl: 'https://example.com/feed.xml',
      },
    ]);
    const publish = vi.fn(async () => publishResult());

    // Drive the real runner with stub fetch/parse/analyze so we exercise
    // pipeline.ts's orchestration + status reporting end-to-end.
    const outcome = await runPipeline(baseConfig, pipeline, {
      runnerDeps: {
        fetchFeeds,
        parseFeeds,
        analyze,
        loadSeen: async () => ({ ids: {} }),
        saveSeen: async () => {},
        saveReport: async () => runnerResult.reportPath!,
        now: () => new Date('2026-04-23T15:45:00.000Z'),
      },
      publish,
    });

    // Publisher was called with the real Report from the runner.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[1]).toEqual({ report: expect.objectContaining({ id: report.id }) });

    expect(outcome.run.status).toBe('success');
    expect(outcome.run.report).toBeDefined();
    expect(outcome.publish?.ok).toBe(true);

    const status = getStatus(pipeline.id);
    expect(status).toMatchObject({
      pipelineId: pipeline.id,
      lastRunStatus: 'success',
      lastItemCount: 2,
      lastModelUsed: 'test-model',
      lastReportId: report.id,
      lastRunAt: report.generatedAt,
    });
  });

  it('skips publisher when runner reports skipped (no new items)', async () => {
    const pipeline = makePipeline('beta');
    const publish = vi.fn(async () => publishResult());

    const outcome = await runPipeline(baseConfig, pipeline, {
      runnerDeps: {
        fetchFeeds: async () => [],
        parseFeeds: () => [],
        analyze: vi.fn(),
        loadSeen: async () => ({ ids: {} }),
        saveSeen: async () => {},
        saveReport: async () => 'unused',
      },
      publish,
    });

    expect(outcome.run.status).toBe('skipped');
    expect(publish).not.toHaveBeenCalled();
    expect(outcome.publish).toBeUndefined();

    const status = getStatus(pipeline.id);
    expect(status?.lastRunStatus).toBe('skipped');
  });

  it('records runner error in status and does not call publisher', async () => {
    const pipeline = makePipeline('gamma');
    const publish = vi.fn(async () => publishResult());

    const analyze = vi.fn(async () => {
      throw new Error('boom');
    });

    const outcome = await runPipeline(baseConfig, pipeline, {
      runnerDeps: {
        fetchFeeds: async () => [
          { group: pipeline.feedGroups[0]!, xml: '<xml />' },
        ],
        parseFeeds: () => [
          {
            id: 'x',
            title: 't',
            link: 'https://example.com/x',
            content: 'c',
            publishedAt: new Date('2026-04-23T00:00:00.000Z'),
            source: 'Group',
            sourceUrl: 'https://example.com/feed.xml',
          },
        ],
        analyze,
        loadSeen: async () => ({ ids: {} }),
        saveSeen: async () => {},
        saveReport: async () => 'unused',
      },
      publish,
    });

    expect(outcome.run.status).toBe('error');
    expect(publish).not.toHaveBeenCalled();

    const status = getStatus(pipeline.id);
    expect(status?.lastRunStatus).toBe('error');
    expect(status?.lastError).toBe('boom');
  });

  it('respects shouldPublish=false even on runner success', async () => {
    const pipeline = makePipeline('delta');
    const report = makeReport(pipeline);
    const publish = vi.fn(async () => publishResult());

    await runPipeline(baseConfig, pipeline, {
      runnerDeps: {
        fetchFeeds: async () => [],
        parseFeeds: () => [],
        analyze: async () => ({
          body: report.body,
          modelUsed: report.modelUsed,
          toolCalls: 0,
          steps: 1,
          fellBack: false,
        }),
        loadSeen: async () => ({ ids: {} }),
        saveSeen: async () => {},
        saveReport: async () => '/tmp/x.json',
        now: () => new Date(report.generatedAt),
      },
      publish,
      shouldPublish: false,
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('records publisher failure as a soft error on status without clobbering run status', async () => {
    const pipeline = makePipeline('epsilon');
    const report = makeReport(pipeline);
    const publish = vi.fn(async () =>
      publishResult({ ok: false, hadChanges: false, commitSha: '', error: 'git push failed' }),
    );

    await runPipeline(baseConfig, pipeline, {
      runnerDeps: {
        fetchFeeds: async () => [
          { group: pipeline.feedGroups[0]!, xml: '<xml />' },
        ],
        parseFeeds: () => [
          {
            id: 'x',
            title: 't',
            link: 'https://example.com/x',
            content: 'c',
            publishedAt: new Date('2026-04-23T00:00:00.000Z'),
            source: 'Group',
            sourceUrl: 'https://example.com/feed.xml',
          },
        ],
        analyze: async () => ({
          body: report.body,
          modelUsed: report.modelUsed,
          toolCalls: 0,
          steps: 1,
          fellBack: false,
        }),
        loadSeen: async () => ({ ids: {} }),
        saveSeen: async () => {},
        saveReport: async () => '/tmp/x.json',
        now: () => new Date(report.generatedAt),
      },
      publish,
    });

    const status = getStatus(pipeline.id);
    expect(status?.lastRunStatus).toBe('success');
    expect(status?.lastError).toBe('publisher: git push failed');
  });
});
