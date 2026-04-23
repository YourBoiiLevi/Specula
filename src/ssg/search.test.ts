import { describe, it, expect } from 'vitest';
import { buildSearchBundle } from './search.js';
import type { Report } from '../types.js';
import Fuse from 'fuse.js';

const mockReport: Report = {
  id: 'test-2026-04-23-12-00',
  pipelineId: 'test',
  pipelineLabel: 'Test Label',
  generatedAt: '2026-04-23T12:00:00Z',
  body: 'This is a test report body with some unique keywords like specula-search-test.',
  sources: [],
  itemCount: 0,
  modelUsed: 'test',
  wordCount: 0,
};

describe('buildSearchBundle', () => {
  it('handles empty reports list', () => {
    const bundle = buildSearchBundle([]);
    expect(bundle.docs).toHaveLength(0);
    expect(bundle.keys).toEqual(['title', 'excerpt', 'pipelineLabel']);
    expect(() => JSON.stringify(bundle.index)).not.toThrow();
  });

  it('covers every report', () => {
    const bundle = buildSearchBundle([mockReport, { ...mockReport, id: '2' }]);
    expect(bundle.docs).toHaveLength(2);
    expect(bundle.docs[0]!.title).toBe('[Test Label] 2026-04-23 12:00 UTC');
  });

  it('round-trips with Fuse.js', () => {
    const bundle = buildSearchBundle([mockReport]);
    const parsedIndex = Fuse.parseIndex(bundle.index as any);
    const fuse = new Fuse(bundle.docs, { keys: bundle.keys }, parsedIndex);
    const results = fuse.search('specula-search-test');
    expect(results).toHaveLength(1);
    expect((results[0]!.item as any).id).toBe('test-2026-04-23-12-00');
  });
});
