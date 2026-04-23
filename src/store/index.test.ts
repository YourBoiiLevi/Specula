import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FeedItem, Report, SeenState } from '../types.js';
import {
  filterUnseen,
  getReport,
  listReports,
  loadSeen,
  markSeen,
  pruneSeen,
  reportDir,
  saveReport,
  saveSeen,
  seenPath,
} from './index.js';

let tmpDir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  prevDataDir = process.env['SPECULA_DATA_DIR'];
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'specula-'));
  process.env['SPECULA_DATA_DIR'] = tmpDir;
});

afterEach(() => {
  if (prevDataDir === undefined) {
    delete process.env['SPECULA_DATA_DIR'];
  } else {
    process.env['SPECULA_DATA_DIR'] = prevDataDir;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeReport(
  pipelineId: string,
  stamp: string,
  generatedAt?: string,
): Report {
  return {
    id: `${pipelineId}-${stamp}`,
    pipelineId,
    pipelineLabel: `Pipeline ${pipelineId}`,
    generatedAt: generatedAt ?? `2026-04-23T${stamp.slice(-5).replace('-', ':')}:00.000Z`,
    itemCount: 1,
    modelUsed: 'test-model',
    sources: [{ label: 'Test', url: 'https://example.com/feed' }],
    body: '# Briefing body',
    wordCount: 2,
  };
}

describe('saveReport', () => {
  it('creates the pipeline directory and writes the file', async () => {
    const report = makeReport('news', '2026-04-23-12-00', '2026-04-23T12:00:00.000Z');
    const filePath = await saveReport(report);

    expect(filePath).toBe(
      path.resolve(path.join(tmpDir, 'reports', 'news', '2026-04-23-12-00.json')),
    );

    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8')) as Report;
    expect(onDisk.id).toBe(report.id);
    expect(onDisk.body).toBe(report.body);
  });

  it('writes pretty-printed JSON', async () => {
    const report = makeReport('news', '2026-04-23-12-00', '2026-04-23T12:00:00.000Z');
    const filePath = await saveReport(report);
    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw).toContain('\n');
    expect(raw).toContain('  "id"');
  });

  it('reportDir/seenPath reflect the current data dir', () => {
    expect(reportDir('news')).toBe(path.join(tmpDir, 'reports', 'news'));
    expect(seenPath('news')).toBe(path.join(tmpDir, 'seen', 'news.json'));
  });
});

describe('listReports', () => {
  it('returns [] when no reports directory exists', async () => {
    expect(await listReports()).toEqual([]);
    expect(await listReports({ pipelineId: 'missing' })).toEqual([]);
  });

  it('returns saved reports sorted newest-first across pipelines', async () => {
    await saveReport(makeReport('news', '2026-04-23-09-00', '2026-04-23T09:00:00.000Z'));
    await saveReport(makeReport('news', '2026-04-23-12-00', '2026-04-23T12:00:00.000Z'));
    await saveReport(makeReport('tech', '2026-04-23-10-00', '2026-04-23T10:00:00.000Z'));

    const all = await listReports();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.generatedAt)).toEqual([
      '2026-04-23T12:00:00.000Z',
      '2026-04-23T10:00:00.000Z',
      '2026-04-23T09:00:00.000Z',
    ]);
  });

  it('filters by pipelineId and respects limit', async () => {
    await saveReport(makeReport('news', '2026-04-23-09-00', '2026-04-23T09:00:00.000Z'));
    await saveReport(makeReport('news', '2026-04-23-12-00', '2026-04-23T12:00:00.000Z'));
    await saveReport(makeReport('news', '2026-04-23-15-00', '2026-04-23T15:00:00.000Z'));
    await saveReport(makeReport('tech', '2026-04-23-11-00', '2026-04-23T11:00:00.000Z'));

    const limited = await listReports({ pipelineId: 'news', limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.map((r) => r.generatedAt)).toEqual([
      '2026-04-23T15:00:00.000Z',
      '2026-04-23T12:00:00.000Z',
    ]);
  });

  it('skips malformed JSON files with a warning', async () => {
    await saveReport(makeReport('news', '2026-04-23-12-00', '2026-04-23T12:00:00.000Z'));
    const garbagePath = path.join(tmpDir, 'reports', 'news', 'garbage.json');
    await fs.writeFile(garbagePath, '{ not json', 'utf8');

    const all = await listReports({ pipelineId: 'news' });
    expect(all).toHaveLength(1);
  });
});

describe('getReport', () => {
  it('round-trips a saved report by id', async () => {
    const report = makeReport('news', '2026-04-23-12-00', '2026-04-23T12:00:00.000Z');
    await saveReport(report);
    const fetched = await getReport(report.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(report.id);
    expect(fetched?.pipelineLabel).toBe(report.pipelineLabel);
  });

  it('returns null for unknown ids', async () => {
    expect(await getReport('nope-2026-01-01-00-00')).toBeNull();
  });
});

describe('seen-state helpers', () => {
  it('loadSeen returns empty state when file is missing', async () => {
    expect(await loadSeen('news')).toEqual({ ids: {} });
  });

  it('saveSeen + loadSeen round-trip', async () => {
    const state: SeenState = {
      ids: {
        a: new Date().toISOString(),
        b: new Date().toISOString(),
      },
    };
    await saveSeen('news', state, 48);
    const loaded = await loadSeen('news');
    expect(Object.keys(loaded.ids).sort()).toEqual(['a', 'b']);
  });

  it('pruneSeen drops entries older than window but keeps recent ones', () => {
    const now = new Date('2026-04-23T12:00:00Z');
    const state: SeenState = {
      ids: {
        old: '2026-04-20T12:00:00Z', // 72h old
        recent: '2026-04-23T06:00:00Z', // 6h old
      },
    };
    const pruned = pruneSeen(state, 48, now);
    expect(pruned.ids).toEqual({ recent: '2026-04-23T06:00:00Z' });
  });

  it('filterUnseen drops items already in state', () => {
    const items: FeedItem[] = [
      {
        id: 'a',
        title: 'A',
        link: 'https://example.com/a',
        content: '',
        publishedAt: new Date(),
        source: 's',
        sourceUrl: 'https://example.com',
      },
      {
        id: 'b',
        title: 'B',
        link: 'https://example.com/b',
        content: '',
        publishedAt: new Date(),
        source: 's',
        sourceUrl: 'https://example.com',
      },
    ];
    const state: SeenState = { ids: { a: new Date().toISOString() } };
    expect(filterUnseen(items, state).map((i) => i.id)).toEqual(['b']);
  });

  it('markSeen adds new ids with the provided timestamp', () => {
    const now = new Date('2026-04-23T12:00:00Z');
    const items: FeedItem[] = [
      {
        id: 'x',
        title: 'X',
        link: 'https://example.com/x',
        content: '',
        publishedAt: now,
        source: 's',
        sourceUrl: 'https://example.com',
      },
    ];
    const state: SeenState = { ids: {} };
    const next = markSeen(state, items, now);
    expect(next.ids).toEqual({ x: '2026-04-23T12:00:00.000Z' });
    // Original state should be untouched.
    expect(state.ids).toEqual({});
  });

  describe('path safety', () => {
    it('reportDir rejects pipelineIds containing path separators', () => {
      expect(() => reportDir('../etc')).toThrow(/Unsafe path segment/);
      expect(() => reportDir('a/b')).toThrow(/Unsafe path segment/);
      expect(() => reportDir('..')).toThrow(/Unsafe path segment/);
      expect(() => reportDir('.')).toThrow(/Unsafe path segment/);
      expect(() => reportDir('')).toThrow(/Unsafe path segment/);
    });

    it('seenPath rejects unsafe pipelineIds', () => {
      expect(() => seenPath('../../secret')).toThrow(/Unsafe path segment/);
      expect(() => seenPath('..')).toThrow(/Unsafe path segment/);
    });

    it('reportDir accepts slug-like ids', () => {
      expect(() => reportDir('news')).not.toThrow();
      expect(() => reportDir('ai-research')).not.toThrow();
      expect(() => reportDir('pipeline-42')).not.toThrow();
    });

    it('saveReport rejects a report whose id contains path traversal after the prefix', async () => {
      const bad: Report = {
        id: 'news-../escape',
        pipelineId: 'news',
        pipelineLabel: 'News',
        generatedAt: '2026-04-23T12:00:00.000Z',
        itemCount: 0,
        modelUsed: 'test',
        sources: [],
        body: '',
        wordCount: 0,
      };
      await expect(saveReport(bad)).rejects.toThrow(/Unsafe path segment/);
    });
  });

  describe('filterUnseen prototype-key safety', () => {
    it('does not treat inherited Object prototype keys as seen', () => {
      const state: SeenState = { ids: {} };
      const items: FeedItem[] = (['toString', 'hasOwnProperty', '__proto__'] as const).map(
        (id) => ({
          id,
          title: id,
          link: `https://example.com/${id}`,
          content: '',
          publishedAt: new Date('2026-04-23T12:00:00Z'),
          source: 's',
          sourceUrl: 'https://example.com',
        }),
      );
      const out = filterUnseen(items, state);
      expect(out.map((i) => i.id)).toEqual(['toString', 'hasOwnProperty', '__proto__']);
    });
  });
});
