import { describe, it, expect, afterEach } from 'vitest';
import { generate } from './index.js';
import type { SpeculaConfig, Report } from '../types.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const mockConfig: SpeculaConfig = {
  githubPagesUrl: 'https://example.com',
  feedTitle: 'Test Feed',
  feedDescription: 'Test Description',
  pipelines: [
    { id: 'p1', label: 'Pipeline 1', description: '', feedGroups: [] },
    { id: 'p2', label: 'Pipeline 2', description: '', feedGroups: [] },
  ],
  intervalHours: 24,
  primaryModel: 'test',
  fallbackModel: 'test',
  thinkingLevel: 'low',
  maxItemsPerRun: 10,
  dedupWindowHours: 24,
  siteRepoPath: '',
  configUiPort: 3000,
};

const mockReports: Report[] = [
  {
    id: 'p1-2026-04-23-12-00',
    pipelineId: 'p1',
    pipelineLabel: 'Pipeline 1',
    generatedAt: '2026-04-23T12:00:00Z',
    body: 'Report 1 body with\n\n```html\n<div id="test-widget"></div>\n```',
    sources: [],
    itemCount: 0,
    modelUsed: 'test',
    wordCount: 0,
  },
  {
    id: 'p2-2026-04-23-13-00',
    pipelineId: 'p2',
    pipelineLabel: 'Pipeline 2',
    generatedAt: '2026-04-23T13:00:00Z',
    body: 'Report 2 body with\n\n```iframe\nhttps://example.com\n```',
    sources: [],
    itemCount: 0,
    modelUsed: 'test',
    wordCount: 0,
  },
  {
    id: 'p1-2026-04-23-14-00',
    pipelineId: 'p1',
    pipelineLabel: 'Pipeline 1',
    generatedAt: '2026-04-23T14:00:00Z',
    body: 'Report 3 body',
    sources: [],
    itemCount: 0,
    modelUsed: 'test',
    wordCount: 0,
  },
  {
    id: 'p2-2026-04-23-15-00',
    pipelineId: 'p2',
    pipelineLabel: 'Pipeline 2',
    generatedAt: '2026-04-23T15:00:00Z',
    body: 'Report 4 body',
    sources: [],
    itemCount: 0,
    modelUsed: 'test',
    wordCount: 0,
  },
  {
    id: 'p1-2026-04-23-16-00',
    pipelineId: 'p1',
    pipelineLabel: 'Pipeline 1',
    generatedAt: '2026-04-23T16:00:00Z',
    body: 'Report 5 body',
    sources: [],
    itemCount: 0,
    modelUsed: 'test',
    wordCount: 0,
  },
];

describe('generate', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates full site', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specula-ssg-test-'));
    
    const result = await generate(mockConfig, { outDir: tmpDir, reports: mockReports });
    
    expect(result.reportCount).toBe(5);
    expect(result.pipelineCount).toBe(2);
    expect(result.outDir).toBe(tmpDir);
    
    const indexHtml = await fs.readFile(path.join(tmpDir, 'index.html'), 'utf-8');
    expect(indexHtml).toContain('Test Feed');
    
    const timelineHtml = await fs.readFile(path.join(tmpDir, 'timeline.html'), 'utf-8');
    expect(timelineHtml).toContain('Timeline');
    
    const feedXml = await fs.readFile(path.join(tmpDir, 'feed.xml'), 'utf-8');
    expect(feedXml).toContain('<?xml');
    expect(feedXml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    
    const searchIndex = await fs.readFile(path.join(tmpDir, 'search-index.json'), 'utf-8');
    expect(() => JSON.parse(searchIndex)).not.toThrow();
    
    const searchDocs = await fs.readFile(path.join(tmpDir, 'search-docs.json'), 'utf-8');
    const docs = JSON.parse(searchDocs);
    expect(docs).toHaveLength(5);
    
    for (const report of mockReports) {
      const reportHtml = await fs.readFile(path.join(tmpDir, 'reports', `${report.id}.html`), 'utf-8');
      expect(reportHtml).toContain(report.pipelineLabel);
    }
    
    const p1Html = await fs.readFile(path.join(tmpDir, 'pipelines', 'p1.html'), 'utf-8');
    expect(p1Html).toContain('Pipeline 1 archive');
    
    const p2Html = await fs.readFile(path.join(tmpDir, 'pipelines', 'p2.html'), 'utf-8');
    expect(p2Html).toContain('Pipeline 2 archive');
    
    const report1Html = await fs.readFile(path.join(tmpDir, 'reports', 'p1-2026-04-23-12-00.html'), 'utf-8');
    expect(report1Html).toContain('report-visualization');
    
    const report2Html = await fs.readFile(path.join(tmpDir, 'reports', 'p2-2026-04-23-13-00.html'), 'utf-8');
    expect(report2Html).toContain('<iframe');
    expect(report2Html).toContain('sandbox="');
    
    const styleCss = await fs.readFile(path.join(tmpDir, 'assets', 'style.css'), 'utf-8');
    expect(styleCss).toContain('--bg: #0a0a0a;');
    
    const appJs = await fs.readFile(path.join(tmpDir, 'assets', 'app.js'), 'utf-8');
    expect(appJs).toContain('document.addEventListener');
    
    const fuseJs = await fs.readFile(path.join(tmpDir, 'assets', 'fuse.min.mjs'), 'utf-8');
    expect(fuseJs.length).toBeGreaterThan(0);
    // Sanity check: the copy should be the real Fuse.js library, not the fallback stub.
    expect(fuseJs).toContain('Fuse');
  });

  it('defaults to config.siteRepoPath when outDir is omitted', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specula-ssg-default-out-'));
    const config = { ...mockConfig, siteRepoPath: tmpDir };

    const result = await generate(config, { reports: mockReports });

    expect(result.outDir).toBe(tmpDir);
    await expect(fs.readFile(path.join(tmpDir, 'index.html'), 'utf-8')).resolves.toContain('Test Feed');
  });

  it('cleans managed output so stale report and archive pages are removed', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specula-ssg-clean-'));
    const config = { ...mockConfig, siteRepoPath: tmpDir };
    const firstRunReports: Report[] = Array.from({ length: 31 }, (_, index) => ({
      id: `p1-2026-04-23-${String(index).padStart(2, '0')}-00`,
      pipelineId: 'p1',
      pipelineLabel: 'Pipeline 1',
      generatedAt: `2026-04-23T${String((index + 1) % 24).padStart(2, '0')}:00:00Z`,
      body: `Report ${index + 1}`,
      sources: [],
      itemCount: 0,
      modelUsed: 'test',
      wordCount: 0,
    }));
    const keptReport = firstRunReports[0]!;
    const staleReport = firstRunReports[firstRunReports.length - 1]!;

    await generate(config, { reports: firstRunReports });

    await expect(fs.access(path.join(tmpDir, 'reports', `${keptReport.id}.html`))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tmpDir, 'reports', `${staleReport.id}.html`))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tmpDir, 'pipelines', 'p1-2.html'))).resolves.toBeUndefined();

    const secondRunReports = [keptReport];
    await generate(config, { reports: secondRunReports });

    await expect(fs.access(path.join(tmpDir, 'reports', `${keptReport.id}.html`))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tmpDir, 'reports', `${staleReport.id}.html`))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'pipelines', 'p1-2.html'))).rejects.toThrow();
  });
});
