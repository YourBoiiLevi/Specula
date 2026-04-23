import { generateText, stepCountIs, type LanguageModel } from 'ai';
import { google } from '@ai-sdk/google';
import type { FeedItem, Pipeline, SpeculaConfig } from '../types.js';
import { itemToMarkdown } from '../parser/toMarkdown.js';
import { createBashTool } from './bashTool.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';

export interface AnalyzerUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AnalyzerResult {
  /** Raw markdown body returned by the model (may contain fenced html/iframe) */
  body: string;
  /** Actual model ID used (primary or fallback) */
  modelUsed: string;
  usage?: AnalyzerUsage;
  /** Number of tool calls the model issued */
  toolCalls: number;
  /** Number of generation steps */
  steps: number;
  /** Whether fallback was used due to a rate-limit error on primary */
  fellBack: boolean;
}

export interface AnalyzerDeps {
  /** Override the `generateText` import for tests. Default: AI SDK's real one. */
  generateText?: typeof import('ai').generateText;
  /** Override the Google provider factory. Default: google from @ai-sdk/google. */
  google?: (modelId: string) => LanguageModel;
}

const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeId(id: string): string {
  return id.replace(FILENAME_SAFE, '_');
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** Exposed for tests. Builds the files object passed to the bash tool. */
export function buildVfsFiles(items: FeedItem[]): Record<string, string> {
  const files: Record<string, string> = {};
  const rows: string[] = [];
  for (const item of items) {
    const safeId = sanitizeId(item.id);
    const filePath = `/feeds/${safeId}.md`;
    files[filePath] = itemToMarkdown(item);
    rows.push(
      `| ${filePath} | ${escapePipe(item.title)} | ${escapePipe(item.source)} | ${item.publishedAt.toISOString()} |`,
    );
  }
  const lines = [
    `# Feed items (${items.length} total)`,
    '',
    '| File | Title | Source | Published |',
    '|------|-------|--------|-----------|',
    ...rows,
  ];
  files['/index.md'] = lines.join('\n');
  return files;
}

function matchesRateLimitShape(e: unknown): boolean {
  if (e == null) return false;
  if (typeof e !== 'object') return false;
  const rec = e as Record<string, unknown>;
  if (rec['statusCode'] === 429) return true;
  if (rec['status'] === 429) return true;
  if (rec['code'] === 429) return true;
  if (rec['name'] === 'AI_RateLimitError') return true;
  const msg = rec['message'];
  if (typeof msg === 'string' && /rate limit|quota|exceeded|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return true;
  }
  return false;
}

/** Exposed for tests. Returns `true` if this error should trigger a fallback retry. */
export function isRateLimitError(err: unknown): boolean {
  if (err == null) return false;
  if (matchesRateLimitShape(err)) return true;
  if (typeof err === 'object' && err !== null && 'cause' in err) {
    const cause = (err as { cause?: unknown }).cause;
    if (matchesRateLimitShape(cause)) return true;
  }
  return false;
}

interface StepLike {
  toolCalls?: ReadonlyArray<unknown>;
}

function countToolCalls(steps: unknown): number {
  if (!Array.isArray(steps)) return 0;
  let n = 0;
  for (const step of steps as StepLike[]) {
    if (Array.isArray(step?.toolCalls)) n += step.toolCalls.length;
  }
  return n;
}

function countSteps(steps: unknown): number {
  return Array.isArray(steps) ? steps.length : 0;
}

interface RawUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
}

function extractUsage(usage: unknown): AnalyzerUsage | undefined {
  if (usage == null || typeof usage !== 'object') return undefined;
  const raw = usage as RawUsage;
  const out: AnalyzerUsage = {};
  if (typeof raw.inputTokens === 'number') out.inputTokens = raw.inputTokens;
  if (typeof raw.outputTokens === 'number') out.outputTokens = raw.outputTokens;
  if (typeof raw.totalTokens === 'number') out.totalTokens = raw.totalTokens;
  return Object.keys(out).length > 0 ? out : undefined;
}

interface GenerateResultLike {
  text: string;
  usage?: unknown;
  steps?: unknown;
}

function finalize(
  result: GenerateResultLike,
  modelUsed: string,
  fellBack: boolean,
  pipelineId: string,
): AnalyzerResult {
  const steps = countSteps(result.steps);
  const toolCalls = countToolCalls(result.steps);
  console.log(
    `[analyzer] ${pipelineId}: done (${steps} steps, ${toolCalls} tool calls, ${result.text.length} chars)`,
  );
  const usage = extractUsage(result.usage);
  const base: AnalyzerResult = {
    body: result.text,
    modelUsed,
    toolCalls,
    steps,
    fellBack,
  };
  if (usage) base.usage = usage;
  return base;
}

export async function analyze(
  items: FeedItem[],
  pipeline: Pipeline,
  config: SpeculaConfig,
  deps?: AnalyzerDeps,
): Promise<AnalyzerResult> {
  if (items.length === 0) {
    throw new Error(
      `analyze called with zero items for pipeline ${pipeline.id}; callers should short-circuit.`,
    );
  }

  const maxItems = pipeline.maxItemsPerRun ?? config.maxItemsPerRun;
  const sliced = items.slice(0, maxItems);

  const modelTier = pipeline.modelTier ?? 'primary';
  const primaryId = modelTier === 'primary' ? config.primaryModel : config.fallbackModel;
  const fallbackId = config.fallbackModel;

  const files = buildVfsFiles(sliced);
  const bashTool = createBashTool({ files, cwd: '/' });

  const system = buildSystemPrompt(pipeline, sliced.length);
  const user = buildUserPrompt(pipeline, sliced.length, new Date().toISOString());

  const gen = deps?.generateText ?? generateText;
  const modelFactory: (modelId: string) => LanguageModel =
    deps?.google ?? ((id: string) => google(id));

  async function runOnce(modelId: string): Promise<GenerateResultLike> {
    console.log(
      `[analyzer] ${pipeline.id}: analyzing ${sliced.length} items with ${modelId} (thinking=${config.thinkingLevel})`,
    );
    const result = await gen({
      model: modelFactory(modelId),
      tools: { bash: bashTool.tool },
      system,
      prompt: user,
      stopWhen: stepCountIs(10),
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: config.thinkingLevel,
          },
        },
      },
    });
    return result as unknown as GenerateResultLike;
  }

  try {
    const result = await runOnce(primaryId);
    return finalize(result, primaryId, false, pipeline.id);
  } catch (err) {
    if (isRateLimitError(err) && fallbackId !== primaryId) {
      console.warn(
        `[analyzer] rate-limit on ${primaryId} — falling back to ${fallbackId}`,
      );
      const result = await runOnce(fallbackId);
      return finalize(result, fallbackId, true, pipeline.id);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analyzer] ${pipeline.id}: failed — ${message}`);
    throw err;
  }
}
