import path from 'node:path';
import fs from 'node:fs/promises';
import type { SpeculaConfig, Report } from '../types.js';
import { listReports } from '../store/index.js';
import { renderReportBody } from './render.js';
import { buildAtomFeed } from './feed.js';
import { buildSearchBundle } from './search.js';
import { STYLE_CSS, APP_JS, copyFuseJs } from './assets.js';
import {
  renderIndex,
  renderTimeline,
  renderReportPage,
  renderPipelineArchive,
} from './templates.js';

export interface GenerateOptions {
  outDir?: string;
  reports?: Report[];
  now?: Date;
}

export interface GenerateResult {
  reportCount: number;
  pipelineCount: number;
  outDir: string;
  durationMs: number;
}

export async function generate(
  config: SpeculaConfig,
  options?: GenerateOptions,
): Promise<GenerateResult> {
  const start = Date.now();
  const outDir = path.resolve(options?.outDir ?? './site');
  
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(path.join(outDir, 'reports'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'pipelines'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'assets'), { recursive: true });
  
  const reports = options?.reports ?? await listReports();
  
  // Sort all reports newest first
  reports.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  
  // Write assets
  await fs.writeFile(path.join(outDir, 'assets', 'style.css'), STYLE_CSS, 'utf-8');
  await fs.writeFile(path.join(outDir, 'assets', 'app.js'), APP_JS, 'utf-8');
  await copyFuseJs(path.join(outDir, 'assets', 'fuse.min.mjs'));
  
  let pageCount = 0;
  
  // Render report pages
  for (const report of reports) {
    const { html } = renderReportBody(report.body);
    const pageHtml = renderReportPage(config, report, html);
    await fs.writeFile(path.join(outDir, 'reports', `${report.id}.html`), pageHtml, 'utf-8');
    pageCount++;
  }
  
  // Group by pipeline
  const byPipeline = new Map<string, Report[]>();
  for (const p of config.pipelines) {
    byPipeline.set(p.id, []);
  }
  
  for (const report of reports) {
    if (byPipeline.has(report.pipelineId)) {
      byPipeline.get(report.pipelineId)!.push(report);
    }
  }
  
  // Render pipeline archives
  for (const p of config.pipelines) {
    const pReports = byPipeline.get(p.id) || [];
    const pageSize = 30;
    const totalPages = Math.max(1, Math.ceil(pReports.length / pageSize));
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const startIdx = (pageNum - 1) * pageSize;
      const pageReports = pReports.slice(startIdx, startIdx + pageSize);
      
      const html = renderPipelineArchive(config, p.id, p.label, pageReports, pageNum, totalPages);
      
      const filename = pageNum === 1 ? `${p.id}.html` : `${p.id}-${pageNum}.html`;
      await fs.writeFile(path.join(outDir, 'pipelines', filename), html, 'utf-8');
      pageCount++;
    }
  }
  
  // Render index
  const latestByPipeline = new Map<string, Report[]>();
  for (const p of config.pipelines) {
    const pReports = byPipeline.get(p.id) || [];
    latestByPipeline.set(p.id, pReports.slice(0, 10));
  }
  
  const indexHtml = renderIndex(config, latestByPipeline);
  await fs.writeFile(path.join(outDir, 'index.html'), indexHtml, 'utf-8');
  pageCount++;
  
  // Render timeline
  const timelineHtml = renderTimeline(config, reports);
  await fs.writeFile(path.join(outDir, 'timeline.html'), timelineHtml, 'utf-8');
  pageCount++;
  
  // Render feed
  const feedXml = buildAtomFeed(reports, config);
  await fs.writeFile(path.join(outDir, 'feed.xml'), feedXml, 'utf-8');
  pageCount++;
  
  // Render search
  const searchBundle = buildSearchBundle(reports);
  await fs.writeFile(path.join(outDir, 'search-index.json'), JSON.stringify(searchBundle.index), 'utf-8');
  await fs.writeFile(path.join(outDir, 'search-docs.json'), JSON.stringify(searchBundle.docs), 'utf-8');
  
  const durationMs = Date.now() - start;
  
  console.log(`[ssg] generated ${pageCount} pages for ${config.pipelines.length} pipelines in ${durationMs}ms → ${outDir}`);
  
  return {
    reportCount: reports.length,
    pipelineCount: config.pipelines.length,
    outDir,
    durationMs,
  };
}
