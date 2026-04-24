import type {
  FeedFetchResult,
  FeedItem,
  Pipeline,
  Report,
  SpeculaConfig,
} from '../types.js';
import { analyze as analyzeWithModel, type AnalyzerResult } from '../analyzer/index.js';
import { fetchFeeds as fetchFeedGroups } from '../fetcher/index.js';
import { parseFeeds as parseFeedResults } from '../parser/index.js';
import {
  filterUnseen,
  loadSeen as loadSeenState,
  markSeen,
  saveReport as persistReport,
  saveSeen as persistSeenState,
} from '../store/index.js';

export interface PipelineRunnerDeps {
  fetchFeeds?: (groups: Pipeline['feedGroups']) => Promise<FeedFetchResult[]>;
  parseFeeds?: (results: FeedFetchResult[]) => FeedItem[];
  analyze?: (
    items: FeedItem[],
    pipeline: Pipeline,
    config: SpeculaConfig,
  ) => Promise<AnalyzerResult>;
  loadSeen?: (pipelineId: string) => Promise<{ ids: Record<string, string> }>;
  saveSeen?: (
    pipelineId: string,
    state: { ids: Record<string, string> },
    windowHours: number,
  ) => Promise<void>;
  saveReport?: (report: Report) => Promise<string>;
  now?: () => Date;
}

export interface RunPipelineResult {
  pipelineId: string;
  pipelineLabel: string;
  status: 'success' | 'skipped' | 'error';
  fetchedGroups: number;
  fetchErrors: number;
  parsedItems: number;
  dedupedItems: number;
  unseenItems: number;
  analyzedItems: number;
  reportId?: string;
  reportPath?: string;
  modelUsed?: string;
  /** The full Report on success. Populated iff status === 'success'. */
  report?: Report;
  skippedReason?: string;
  error?: string;
}

export interface RunPipelinesResult {
  startedAt: string;
  finishedAt: string;
  pipelineCount: number;
  successCount: number;
  skippedCount: number;
  errorCount: number;
  results: RunPipelineResult[];
}

function dedupeItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const deduped: FeedItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function buildSources(items: FeedItem[]): Report['sources'] {
  const seen = new Set<string>();
  const sources: Report['sources'] = [];
  for (const item of items) {
    const key = `${item.source}|${item.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ label: item.source, url: item.sourceUrl });
  }
  return sources;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function formatReportStamp(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}-${minutes}`;
}

function createReport(
  pipeline: Pipeline,
  items: FeedItem[],
  analysis: AnalyzerResult,
  now: Date,
): Report {
  const stamp = formatReportStamp(now);
  return {
    id: `${pipeline.id}-${stamp}`,
    pipelineId: pipeline.id,
    pipelineLabel: pipeline.label,
    generatedAt: now.toISOString(),
    itemCount: items.length,
    modelUsed: analysis.modelUsed,
    sources: buildSources(items),
    body: analysis.body,
    wordCount: countWords(analysis.body),
  };
}

export async function runPipeline(
  config: SpeculaConfig,
  pipeline: Pipeline,
  deps?: PipelineRunnerDeps,
): Promise<RunPipelineResult> {
  const fetchFeeds = deps?.fetchFeeds ?? fetchFeedGroups;
  const parseFeeds = deps?.parseFeeds ?? parseFeedResults;
  const analyze = deps?.analyze ?? analyzeWithModel;
  const loadSeen = deps?.loadSeen ?? loadSeenState;
  const saveSeen = deps?.saveSeen ?? persistSeenState;
  const saveReport = deps?.saveReport ?? persistReport;
  const nowFactory = deps?.now ?? (() => new Date());

  const fetched = await fetchFeeds(pipeline.feedGroups);
  const parsed = parseFeeds(fetched);
  const deduped = dedupeItems(parsed);
  const seen = await loadSeen(pipeline.id);
  const unseen = filterUnseen(deduped, seen);
  const maxItems = pipeline.maxItemsPerRun ?? config.maxItemsPerRun;
  const selected = unseen.slice(0, maxItems);

  const baseResult = {
    pipelineId: pipeline.id,
    pipelineLabel: pipeline.label,
    fetchedGroups: fetched.length,
    fetchErrors: fetched.filter((result) => result.error).length,
    parsedItems: parsed.length,
    dedupedItems: deduped.length,
    unseenItems: unseen.length,
    analyzedItems: selected.length,
  };

  if (selected.length === 0) {
    await saveSeen(pipeline.id, seen, config.dedupWindowHours);
    return {
      ...baseResult,
      status: 'skipped',
      skippedReason: unseen.length === 0 ? 'no-unseen-items' : 'max-items-zero',
    };
  }

  try {
    const analysis = await analyze(selected, pipeline, config);
    const now = nowFactory();
    const report = createReport(pipeline, selected, analysis, now);
    const reportPath = await saveReport(report);
    const nextSeen = markSeen(seen, selected, now);
    await saveSeen(pipeline.id, nextSeen, config.dedupWindowHours);
    return {
      ...baseResult,
      status: 'success',
      reportId: report.id,
      reportPath,
      modelUsed: analysis.modelUsed,
      report,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...baseResult,
      status: 'error',
      error: message,
    };
  }
}

export async function runPipelines(
  config: SpeculaConfig,
  deps?: PipelineRunnerDeps,
  pipelineIds?: string[],
): Promise<RunPipelinesResult> {
  const startedAt = (deps?.now ?? (() => new Date()))().toISOString();
  const selectedPipelines =
    pipelineIds && pipelineIds.length > 0
      ? config.pipelines.filter((pipeline) => pipelineIds.includes(pipeline.id))
      : config.pipelines;

  const missingPipelineIds =
    pipelineIds?.filter(
      (pipelineId) => !selectedPipelines.some((pipeline) => pipeline.id === pipelineId),
    ) ?? [];
  if (missingPipelineIds.length > 0) {
    throw new Error(`Unknown pipeline ids: ${missingPipelineIds.join(', ')}`);
  }

  const results: RunPipelineResult[] = [];
  for (const pipeline of selectedPipelines) {
    results.push(await runPipeline(config, pipeline, deps));
  }

  const finishedAt = (deps?.now ?? (() => new Date()))().toISOString();
  return {
    startedAt,
    finishedAt,
    pipelineCount: selectedPipelines.length,
    successCount: results.filter((result) => result.status === 'success').length,
    skippedCount: results.filter((result) => result.status === 'skipped').length,
    errorCount: results.filter((result) => result.status === 'error').length,
    results,
  };
}
