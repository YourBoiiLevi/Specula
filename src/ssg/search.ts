import type { Report } from '../types.js';
import { plainTextExcerpt } from './render.js';
import Fuse from 'fuse.js';

export interface SearchDoc {
  id: string;
  url: string;
  title: string;
  pipelineId: string;
  pipelineLabel: string;
  generatedAt: string;
  excerpt: string;
}

export interface SearchBundle {
  index: unknown;
  docs: SearchDoc[];
  keys: string[];
}

export function buildSearchBundle(reports: Report[]): SearchBundle {
  const docs: SearchDoc[] = reports.map((report) => {
    const dateObj = new Date(report.generatedAt);
    const yyyy = dateObj.getUTCFullYear();
    const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getUTCDate()).padStart(2, '0');
    const hh = String(dateObj.getUTCHours()).padStart(2, '0');
    const min = String(dateObj.getUTCMinutes()).padStart(2, '0');
    const title = `[${report.pipelineLabel}] ${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
    
    return {
      id: report.id,
      url: `/reports/${report.id}.html`,
      title,
      pipelineId: report.pipelineId,
      pipelineLabel: report.pipelineLabel,
      generatedAt: report.generatedAt,
      excerpt: plainTextExcerpt(report.body, 500),
    };
  });

  const keys = [
    { name: 'title', weight: 0.5 },
    { name: 'excerpt', weight: 0.3 },
    { name: 'pipelineLabel', weight: 0.2 },
  ];

  const index = Fuse.createIndex(keys, docs).toJSON();

  return {
    index,
    docs,
    keys: keys.map(k => k.name),
  };
}
