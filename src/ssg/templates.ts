import type { Report, SpeculaConfig } from '../types.js';
import type { SearchDoc } from './search.js';

export interface LayoutContext {
  config: SpeculaConfig;
  root: string;
  title: string;
  section: 'home' | 'timeline' | 'report' | 'pipeline';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderLayout(ctx: LayoutContext, bodyHtml: string): string {
  const { config, root, title, section } = ctx;
  const isoNow = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc(config.feedDescription)}">
  <title>${esc(title)}</title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
  <link rel="stylesheet" href="${root}assets/style.css">
  <link rel="alternate" type="application/atom+xml" title="${esc(config.feedTitle)}" href="${root}feed.xml">
  <script src="${root}assets/fuse.min.js" defer></script>
  <script src="${root}assets/app.js" defer></script>
</head>
<body>
  <header>
    <div class="site-title">${esc(config.feedTitle)}</div>
    <nav>
      <a href="${root}index.html" ${section === 'home' ? 'aria-current="page"' : ''}>Home</a>
      <a href="${root}timeline.html" ${section === 'timeline' ? 'aria-current="page"' : ''}>Timeline</a>
      <a href="${root}feed.xml" target="_blank" rel="noopener noreferrer">RSS ↗</a>
    </nav>
  </header>
  <main>
    ${bodyHtml}
  </main>
  <footer>
    <div>${esc(config.feedTitle)} · <span id="utc-clock"></span></div>
    <div>Built at ${esc(isoNow)}</div>
  </footer>
</body>
</html>`;
}

export function renderIndex(config: SpeculaConfig, latestByPipeline: Map<string, Report[]>): string {
  let html = `
    <div class="hero">
      <h1>${esc(config.feedTitle)}</h1>
      <p>${esc(config.feedDescription)}</p>
    </div>
    
    <input type="search" id="specula-search" placeholder="Search reports..." data-root="./" aria-label="Search reports">
    <div id="specula-search-results" style="display: none; margin-bottom: 2rem;"></div>
    
    <div class="tabs" role="tablist">
  `;

  const pipelines = config.pipelines;
  
  pipelines.forEach((p, i) => {
    const isSelected = i === 0;
    html += `<button class="tab" role="tab" aria-selected="${isSelected}" aria-controls="panel-${esc(p.id)}" id="tab-${esc(p.id)}" tabindex="${isSelected ? 0 : -1}">${esc(p.label)}</button>`;
  });
  
  html += `</div>`;

  pipelines.forEach((p, i) => {
    const isActive = i === 0;
    const reports = latestByPipeline.get(p.id) || [];
    
    html += `<div class="tab-panel ${isActive ? 'active' : ''}" id="panel-${esc(p.id)}" role="tabpanel" aria-labelledby="tab-${esc(p.id)}">`;
    
    if (reports.length === 0) {
      html += `<div class="report-row" style="color: var(--fg-muted)">No reports yet.</div>`;
    } else {
      reports.forEach(r => {
        const dateStr = r.generatedAt.replace('T', ' ').substring(0, 16);
        html += `
          <a href="./reports/${esc(r.id)}.html" class="report-row">
            <div class="report-meta">${esc(dateStr)} UTC</div>
            <div class="report-title">${esc(r.pipelineLabel)} — ${esc(dateStr)}</div>
            <div class="report-excerpt">${esc(r.body.substring(0, 100))}...</div>
          </a>
        `;
      });
      html += `<a href="./pipelines/${esc(p.id)}.html" class="report-row" style="text-align: center; color: var(--accent); margin-top: 1rem;">View all ${esc(p.label)} reports →</a>`;
    }
    
    html += `</div>`;
  });

  return renderLayout({
    config,
    root: './',
    title: config.feedTitle,
    section: 'home'
  }, html);
}

export function renderTimeline(config: SpeculaConfig, reports: Report[]): string {
  let html = `<h1>Timeline</h1>`;
  
  let currentDate = '';
  
  reports.forEach(r => {
    const dateObj = new Date(r.generatedAt);
    const yyyy = dateObj.getUTCFullYear();
    const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    
    if (dateStr !== currentDate) {
      html += `<h2>${esc(dateStr)}</h2>`;
      currentDate = dateStr;
    }
    
    const hh = String(dateObj.getUTCHours()).padStart(2, '0');
    const min = String(dateObj.getUTCMinutes()).padStart(2, '0');
    
    html += `
      <a href="./reports/${esc(r.id)}.html" class="report-row">
        <div class="report-meta">${esc(hh)}:${esc(min)} UTC <span class="chip">${esc(r.pipelineLabel)}</span></div>
        <div class="report-title">${esc(r.pipelineLabel)} — ${esc(dateStr)} ${esc(hh)}:${esc(min)}</div>
        <div class="report-excerpt">${esc(r.body.substring(0, 100))}...</div>
      </a>
    `;
  });

  return renderLayout({
    config,
    root: './',
    title: `Timeline - ${config.feedTitle}`,
    section: 'timeline'
  }, html);
}

export function renderReportPage(config: SpeculaConfig, report: Report, renderedBodyHtml: string): string {
  const dateStr = report.generatedAt.replace('T', ' ').substring(0, 16);
  
  let html = `
    <div style="margin-bottom: 2rem; font-size: 0.875rem; color: var(--fg-dim);">
      <a href="../index.html" style="color: inherit; text-decoration: none;">${esc(config.feedTitle)}</a> / 
      <a href="../pipelines/${esc(report.pipelineId)}.html" style="color: inherit; text-decoration: none;">${esc(report.pipelineLabel)}</a> / 
      ${esc(report.id)}
    </div>
    
    <h1 style="margin-top: 0;">${esc(report.pipelineLabel)} — ${esc(dateStr)} UTC</h1>
    
    <div class="report-meta" style="margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
      Model: ${esc(report.modelUsed || 'Unknown')} · Items analyzed: ${report.itemCount || 0} · Words: ${report.wordCount || 0}
    </div>
    
    <div class="report-layout">
      <div class="report-body">
        ${renderedBodyHtml}
        
        <div style="margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--border);">
          <a href="../pipelines/${esc(report.pipelineId)}.html">← More from ${esc(report.pipelineLabel)}</a>
        </div>
      </div>
  `;
  
  if (report.sources && report.sources.length > 0) {
    html += `
      <div class="report-sidebar">
        <div class="sources-list">
          <h3>Sources</h3>
          <ul>
            ${report.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }
  
  html += `</div>`;

  return renderLayout({
    config,
    root: '../',
    title: `${report.pipelineLabel} — ${dateStr} UTC - ${config.feedTitle}`,
    section: 'report'
  }, html);
}

export function renderPipelineArchive(
  config: SpeculaConfig,
  pipelineId: string,
  pipelineLabel: string,
  pageReports: Report[],
  pageNum: number,
  totalPages: number,
): string {
  let html = `
    <h1>${esc(pipelineLabel)} archive</h1>
    <p style="color: var(--fg-dim); margin-bottom: 2rem;">Page ${pageNum} of ${totalPages}</p>
  `;
  
  pageReports.forEach(r => {
    const dateStr = r.generatedAt.replace('T', ' ').substring(0, 16);
    html += `
      <a href="../reports/${esc(r.id)}.html" class="report-row">
        <div class="report-meta">${esc(dateStr)} UTC</div>
        <div class="report-title">${esc(r.pipelineLabel)} — ${esc(dateStr)}</div>
        <div class="report-excerpt">${esc(r.body.substring(0, 100))}...</div>
      </a>
    `;
  });
  
  html += `<div class="pagination">`;
  
  if (pageNum > 1) {
    const prevPage = pageNum === 2 ? `${esc(pipelineId)}.html` : `${esc(pipelineId)}-${pageNum - 1}.html`;
    html += `<a href="./${prevPage}">← Newer</a>`;
  } else {
    html += `<span></span>`;
  }
  
  if (pageNum < totalPages) {
    html += `<a href="./${esc(pipelineId)}-${pageNum + 1}.html">Older →</a>`;
  } else {
    html += `<span></span>`;
  }
  
  html += `</div>`;

  return renderLayout({
    config,
    root: '../',
    title: `${pipelineLabel} Archive - Page ${pageNum} - ${config.feedTitle}`,
    section: 'pipeline'
  }, html);
}
