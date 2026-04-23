export interface FeedGroup {
  id: string;
  label: string;
  url: string;
}

export interface Pipeline {
  id: string;
  label: string;
  description: string;
  feedGroups: FeedGroup[];
  focusInstructions?: string;
  /** Optional per-pipeline cap overriding global `maxItemsPerRun` */
  maxItemsPerRun?: number;
  /** Which of the two configured models this pipeline should use. Defaults to "primary". */
  modelTier?: 'primary' | 'fallback';
}

export interface ConfigUiAuth {
  user: string;
  pass: string;
}

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface SpeculaConfig {
  /** Always 1 for now. Reserved for future flexibility. */
  intervalHours: number;

  // AI
  primaryModel: string;
  fallbackModel: string;
  thinkingLevel: ThinkingLevel;
  /** Global cap on items per pipeline run; can be overridden per-pipeline */
  maxItemsPerRun: number;

  // Dedup
  dedupWindowHours: number;

  // Publisher
  siteRepoPath: string;
  githubPagesUrl: string;

  // RSS output
  feedTitle: string;
  feedDescription: string;

  // Config UI
  configUiPort: number;
  configUiAuth?: ConfigUiAuth;

  pipelines: Pipeline[];
}

export interface FeedItem {
  /** Stable ID: guid if present, else link, else hash of title+publishedAt */
  id: string;
  title: string;
  link: string;
  /** Full content with HTML tags stripped (no truncation) */
  content: string;
  publishedAt: Date;
  /** Human-readable source label (from FeedGroup.label) */
  source: string;
  /** Source URL (FeedGroup.url) */
  sourceUrl: string;
}

export interface FeedFetchResult {
  group: FeedGroup;
  xml: string | null;
  error?: string;
}

export interface ReportSource {
  label: string;
  url: string;
}

export interface Report {
  id: string;
  pipelineId: string;
  pipelineLabel: string;
  generatedAt: string;
  itemCount: number;
  modelUsed: string;
  sources: ReportSource[];
  body: string;
  wordCount: number;
}

export interface SeenState {
  /** Map of itemId -> ISO timestamp when first seen */
  ids: Record<string, string>;
}

export interface PipelineRunStatus {
  pipelineId: string;
  lastRunAt?: string;
  lastRunStatus: 'idle' | 'running' | 'success' | 'error' | 'skipped';
  lastError?: string;
  lastItemCount?: number;
  lastModelUsed?: string;
  lastReportId?: string;
}
