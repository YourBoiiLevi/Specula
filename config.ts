import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { SpeculaConfig } from './src/types.js';

const FACTORS_OF_60 = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60] as const;

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

const SlugSchema = z
  .string()
  .regex(
    SLUG_REGEX,
    'id must be slug-like and match /^[a-z0-9][a-z0-9-]*$/ (lowercase letters, digits, hyphens; must start with letter or digit)',
  );

const FeedGroupSchema = z.object({
  id: SlugSchema,
  label: z.string().min(1),
  url: z.string().min(1),
});

const PipelineSchema = z
  .object({
    id: SlugSchema,
    label: z.string().min(1),
    description: z.string(),
    feedGroups: z.array(FeedGroupSchema).min(1),
    focusInstructions: z.string().optional(),
    maxItemsPerRun: z.number().int().min(1).optional(),
    modelTier: z.enum(['primary', 'fallback']).optional(),
  })
  .superRefine((pipeline, ctx) => {
    const seen = new Set<string>();
    for (const [index, group] of pipeline.feedGroups.entries()) {
      if (seen.has(group.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['feedGroups', index, 'id'],
          message: `Duplicate feedGroup id "${group.id}" within pipeline "${pipeline.id}"`,
        });
      }
      seen.add(group.id);
    }
  });

const ConfigUiAuthSchema = z.object({
  user: z.string().min(1),
  pass: z.string().min(1),
});

const ThinkingLevelSchema = z.enum(['minimal', 'low', 'medium', 'high']);

const SpeculaConfigSchema = z
  .object({
    intervalHours: z.number().int().min(1),

    primaryModel: z.string().min(1),
    fallbackModel: z.string().min(1),
    thinkingLevel: ThinkingLevelSchema,
    maxItemsPerRun: z.number().int().min(1),

    dedupWindowHours: z.number().int().min(1),

    siteRepoPath: z.string().min(1),
    githubPagesUrl: z.string().min(1),

    feedTitle: z.string().min(1),
    feedDescription: z.string(),

    configUiPort: z.number().int().min(1).max(65535),
    configUiAuth: ConfigUiAuthSchema.optional(),

    pipelines: z.array(PipelineSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    if (!(FACTORS_OF_60 as readonly number[]).includes(cfg.pipelines.length)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pipelines'],
        message: `pipelines.length must be a factor of 60. Received ${cfg.pipelines.length}. Valid values: ${FACTORS_OF_60.join(', ')}.`,
      });
    }
    const seen = new Set<string>();
    for (const [index, pipeline] of cfg.pipelines.entries()) {
      if (seen.has(pipeline.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['pipelines', index, 'id'],
          message: `Duplicate pipeline id "${pipeline.id}"`,
        });
      }
      seen.add(pipeline.id);
    }
  });

export const CONFIG_PATH: string = path.resolve(process.cwd(), 'config.json');
const EXAMPLE_CONFIG_PATH: string = path.resolve(process.cwd(), 'config.json.example');

export function validateConfig(raw: unknown): SpeculaConfig {
  const result = SpeculaConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => {
        const pathStr = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `  - ${pathStr}: ${issue.message}`;
      })
      .join('\n');
    throw new Error(`Invalid Specula config:\n${messages}`);
  }
  // Cast is safe: runtime shape matches SpeculaConfig; the only nominal mismatch
  // stems from zod's optional() inferring `T | undefined` which is compatible
  // with the interface's `?: T` under exactOptionalPropertyTypes at runtime.
  return result.data as SpeculaConfig;
}

export function loadConfig(configPath?: string): SpeculaConfig {
  const primaryPath = configPath ?? CONFIG_PATH;
  let sourcePath = primaryPath;
  if (!existsSync(primaryPath)) {
    if (!existsSync(EXAMPLE_CONFIG_PATH)) {
      throw new Error(
        `No config file found at ${primaryPath} and no config.json.example fallback at ${EXAMPLE_CONFIG_PATH}.`,
      );
    }
    console.warn(
      'No config.json found — using config.json.example. Copy it to config.json and edit via the Config UI.',
    );
    sourcePath = EXAMPLE_CONFIG_PATH;
  }
  const contents = readFileSync(sourcePath, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${sourcePath} as JSON: ${message}`);
  }
  return validateConfig(raw);
}

export function calculateOffsets(n: number): number[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`calculateOffsets: n must be a positive integer, got ${n}`);
  }
  const step = 60 / n;
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    offsets.push(Math.round(step * i));
  }
  return offsets;
}
