import { describe, it, expect } from 'vitest';
import { buildAtomFeed } from './feed.js';
import type { Report, SpeculaConfig } from '../types.js';
import { XMLParser } from 'fast-xml-parser';

const mockConfig: SpeculaConfig = {
  githubPagesUrl: 'https://example.com',
  feedTitle: 'Test Feed & Co',
  feedDescription: 'Test Description',
  pipelines: [],
  intervalHours: 24,
  primaryModel: 'test',
  fallbackModel: 'test',
  thinkingLevel: 'low',
  maxItemsPerRun: 10,
  dedupWindowHours: 24,
  siteRepoPath: '',
  configUiPort: 3000,
};

const mockReport: Report = {
  id: 'test-2026-04-23-12-00',
  pipelineId: 'test',
  pipelineLabel: 'Test <Label>',
  generatedAt: '2026-04-23T12:00:00Z',
  body: 'This is a test report body.',
  sources: [],
  itemCount: 0,
  modelUsed: 'test',
  wordCount: 0,
};

describe('buildAtomFeed', () => {
  it('handles empty reports list', () => {
    const xml = buildAtomFeed([], mockConfig);
    expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<updated>');
    expect(xml).not.toContain('<entry>');
  });

  it('respects limit and sorts by newest', () => {
    const reports: Report[] = [
      { ...mockReport, id: '1', generatedAt: '2026-04-21T12:00:00Z' },
      { ...mockReport, id: '2', generatedAt: '2026-04-23T12:00:00Z' },
      { ...mockReport, id: '3', generatedAt: '2026-04-22T12:00:00Z' },
    ];
    const xml = buildAtomFeed(reports, mockConfig, { limit: 2 });
    
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);
    
    expect(parsed.feed.entry).toHaveLength(2);
    expect(parsed.feed.entry[0].id).toContain('/reports/2.html');
    expect(parsed.feed.entry[1].id).toContain('/reports/3.html');
  });

  it('escapes XML characters', () => {
    const xml = buildAtomFeed([mockReport], mockConfig);
    expect(xml).toContain('Test Feed &amp; Co');
    expect(xml).toContain('Test &lt;Label&gt;');
  });
});
