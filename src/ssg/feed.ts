import type { Report, SpeculaConfig } from '../types.js';
import { plainTextExcerpt } from './render.js';

export interface FeedBuildOptions {
  limit?: number;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildAtomFeed(
  reports: Report[],
  config: SpeculaConfig,
  options?: FeedBuildOptions,
): string {
  const limit = options?.limit ?? 100;
  
  const sorted = [...reports].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const limited = sorted.slice(0, limit);
  
  const updated = limited.length > 0 ? limited[0]!.generatedAt : new Date().toISOString();
  
  const baseUrl = config.githubPagesUrl.replace(/\/$/, '');
  
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<feed xmlns="http://www.w3.org/2005/Atom">\n`;
  xml += `  <id>${escapeXml(baseUrl)}/</id>\n`;
  xml += `  <title>${escapeXml(config.feedTitle)}</title>\n`;
  xml += `  <updated>${escapeXml(updated)}</updated>\n`;
  xml += `  <link rel="self" href="${escapeXml(baseUrl)}/feed.xml"/>\n`;
  xml += `  <link rel="alternate" type="text/html" href="${escapeXml(baseUrl)}/"/>\n`;
  xml += `  <author><name>${escapeXml(config.feedTitle)}</name></author>\n`;
  
  for (const report of limited) {
    const reportUrl = `${baseUrl}/reports/${report.id}.html`;
    const dateObj = new Date(report.generatedAt);
    const yyyy = dateObj.getUTCFullYear();
    const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getUTCDate()).padStart(2, '0');
    const hh = String(dateObj.getUTCHours()).padStart(2, '0');
    const min = String(dateObj.getUTCMinutes()).padStart(2, '0');
    const title = `[${report.pipelineLabel}] ${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
    
    const excerpt = plainTextExcerpt(report.body, 300);
    
    xml += `  <entry>\n`;
    xml += `    <id>${escapeXml(reportUrl)}</id>\n`;
    xml += `    <title>${escapeXml(title)}</title>\n`;
    xml += `    <updated>${escapeXml(report.generatedAt)}</updated>\n`;
    xml += `    <link rel="alternate" type="text/html" href="${escapeXml(reportUrl)}"/>\n`;
    xml += `    <summary type="text">${escapeXml(excerpt)}</summary>\n`;
    xml += `    <category term="${escapeXml(report.pipelineId)}" label="${escapeXml(report.pipelineLabel)}"/>\n`;
    xml += `  </entry>\n`;
  }
  
  xml += `</feed>`;
  return xml;
}
