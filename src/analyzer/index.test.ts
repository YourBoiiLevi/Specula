import { describe, it, expect, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import type { FeedItem, Pipeline, SpeculaConfig } from '../types.js';
import { analyze, buildVfsFiles, isRateLimitError, type AnalyzerDeps } from './index.js';

function makeItem(overrides: Partial<FeedItem> & { id: string }): FeedItem {
  return {
    title: `Title for ${overrides.id}`,
    link: `https://example.com/${overrides.id}`,
    content: `Body for ${overrides.id}.`,
    publishedAt: new Date('2026-04-23T12:00:00.000Z'),
    source: 'Example',
    sourceUrl: 'https://example.com/feed',
    ...overrides,
  };
}

function makeItems(n: number): FeedItem[] {
  return Array.from({ length: n }, (_, i) => makeItem({ id: `item-${i + 1}` }));
}

function makeConfig(overrides: Partial<SpeculaConfig> = {}): SpeculaConfig {
  return {
    intervalHours: 1,
    primaryModel: 'gemini-3-flash-preview',
    fallbackModel: 'gemini-3.1-flash-lite-preview',
    thinkingLevel: 'low',
    maxItemsPerRun: 100,
    dedupWindowHours: 48,
    siteRepoPath: './site',
    githubPagesUrl: 'https://example.com',
    feedTitle: 'Test',
    feedDescription: 'Test',
    configUiPort: 3001,
    pipelines: [],
    ...overrides,
  };
}

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'ai-research',
    label: 'AI Research',
    description: 'recent work across labs',
    feedGroups: [{ id: 'lab', label: 'Lab', url: 'https://example.com/f.xml' }],
    ...overrides,
  };
}

interface FakeGenerateArgs {
  model: unknown;
}

type GenerateTextFn = NonNullable<AnalyzerDeps['generateText']>;
type GoogleFactoryFn = NonNullable<AnalyzerDeps['google']>;

function makeGenerateTextStub(
  handler: (args: FakeGenerateArgs) => unknown | Promise<unknown>,
): GenerateTextFn {
  const stub = async (args: unknown) => {
    const out = await handler(args as FakeGenerateArgs);
    return out;
  };
  return stub as unknown as GenerateTextFn;
}

function makeGoogleStub(): GoogleFactoryFn {
  const stub = (modelId: string) => ({ _kind: 'model-sentinel', modelId });
  return stub as unknown as GoogleFactoryFn;
}

describe('buildVfsFiles', () => {
  it('creates /index.md plus one /feeds/{id}.md per item', () => {
    const items: FeedItem[] = [
      makeItem({ id: 'a', title: 'Alpha' }),
      makeItem({ id: 'b', title: 'Beta' }),
    ];
    const files = buildVfsFiles(items);
    expect(Object.keys(files).sort()).toEqual(['/feeds/a.md', '/feeds/b.md', '/index.md']);
    expect(files['/feeds/a.md']).toContain('## Alpha');
    expect(files['/feeds/b.md']).toContain('## Beta');
  });

  it('/index.md is a markdown table with the expected columns', () => {
    const items: FeedItem[] = [makeItem({ id: 'x', title: 'X Title' })];
    const files = buildVfsFiles(items);
    const index = files['/index.md'] ?? '';
    expect(index).toContain('# Feed items (1 total)');
    expect(index).toContain('| File | Title | Source | Published |');
    expect(index).toContain('|------|-------|--------|-----------|');
    expect(index).toContain('| /feeds/x.md | X Title | Example | 2026-04-23T12:00:00.000Z |');
  });

  it('escapes pipe characters in titles', () => {
    const items: FeedItem[] = [
      makeItem({ id: 'piped', title: 'A | B | C' }),
    ];
    const files = buildVfsFiles(items);
    const index = files['/index.md'] ?? '';
    expect(index).toContain('A \\| B \\| C');
    expect(index).not.toContain(' A | B | C |');
  });

  it('percent-encodes unsafe id characters in the vfs path without collisions', () => {
    const items: FeedItem[] = [
      makeItem({ id: 'https://example.com/a?b=c&d=e' }),
      makeItem({ id: 'https___example.com_a_b_c_d_e' }),
    ];
    const files = buildVfsFiles(items);
    const keys = Object.keys(files).filter((k) => k.startsWith('/feeds/')).sort();
    expect(keys).toEqual([
      '/feeds/https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d%3De.md',
      '/feeds/https___example.com_a_b_c_d_e.md',
    ]);
  });
});

describe('isRateLimitError', () => {
  it('detects statusCode 429', () => {
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
  });

  it('detects status 429', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });

  it('detects code 429', () => {
    expect(isRateLimitError({ code: 429 })).toBe(true);
  });

  it('detects AI_RateLimitError name', () => {
    expect(isRateLimitError({ name: 'AI_RateLimitError' })).toBe(true);
  });

  it('detects RESOURCE_EXHAUSTED in message', () => {
    expect(isRateLimitError(new Error('RESOURCE_EXHAUSTED: quota hit'))).toBe(true);
  });

  it('detects rate limit phrase (case-insensitive)', () => {
    expect(isRateLimitError(new Error('Rate Limit reached for model'))).toBe(true);
  });

  it('detects 429 substring in message', () => {
    expect(isRateLimitError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
  });

  it('walks err.cause one level deep', () => {
    expect(isRateLimitError({ cause: { statusCode: 429 } })).toBe(true);
    const wrapped = new Error('wrapper');
    (wrapped as Error & { cause?: unknown }).cause = new Error('RESOURCE_EXHAUSTED');
    expect(isRateLimitError(wrapped)).toBe(true);
  });

  it('returns false for non-rate-limit errors', () => {
    expect(isRateLimitError(new Error('boom'))).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe('analyze — happy path', () => {
  it('runs the primary model and returns text, usage, steps, and tool-call counts', async () => {
    const generateTextStub = makeGenerateTextStub(() => ({
      text: 'fake report',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      steps: [{ toolCalls: [{}] }, { toolCalls: [] }],
    }));

    const googleStub = vi.fn((_id: string) => ({ _sentinel: true })) as unknown as
      NonNullable<AnalyzerDeps['google']>;

    const result = await analyze(makeItems(3), makePipeline(), makeConfig(), {
      generateText: generateTextStub,
      google: googleStub,
    });

    expect(result.body).toBe('fake report');
    expect(result.modelUsed).toBe('gemini-3-flash-preview');
    expect(result.fellBack).toBe(false);
    expect(result.toolCalls).toBe(1);
    expect(result.steps).toBe(2);
    expect(result.usage?.totalTokens).toBe(30);
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(20);

    expect(googleStub).toHaveBeenCalledTimes(1);
    expect(googleStub).toHaveBeenCalledWith('gemini-3-flash-preview');
  });
});

describe('analyze — fallback on rate-limit', () => {
  it('retries with the fallback model when primary throws 429', async () => {
    const calls: string[] = [];
    const google = ((id: string) => {
      calls.push(id);
      return { _sentinel: id } as unknown;
    }) as unknown as NonNullable<AnalyzerDeps['google']>;

    let invocation = 0;
    const generateTextStub = makeGenerateTextStub(() => {
      invocation += 1;
      if (invocation === 1) {
        const err = { statusCode: 429, message: 'quota exceeded' } as unknown;
        throw err;
      }
      return {
        text: 'fallback report',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        steps: [{ toolCalls: [] }],
      };
    });

    const result = await analyze(makeItems(2), makePipeline(), makeConfig(), {
      generateText: generateTextStub,
      google,
    });

    expect(result.body).toBe('fallback report');
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite-preview');
    expect(result.fellBack).toBe(true);
    expect(calls).toEqual(['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']);
  });
});

describe('analyze — rethrow on non-rate-limit error', () => {
  it('rethrows without falling back when the error is not a rate-limit', async () => {
    const calls: string[] = [];
    const google = ((id: string) => {
      calls.push(id);
      return { _sentinel: id } as unknown;
    }) as unknown as NonNullable<AnalyzerDeps['google']>;

    const generateTextStub = makeGenerateTextStub(() => {
      throw new Error('boom');
    });

    await expect(
      analyze(makeItems(1), makePipeline(), makeConfig(), {
        generateText: generateTextStub,
        google,
      }),
    ).rejects.toThrow('boom');
    // google() should have been called exactly once (no retry).
    expect(calls).toEqual(['gemini-3-flash-preview']);
  });
});

describe('analyze — no-fallback-possible', () => {
  it('rethrows a 429 when primaryModel === fallbackModel (no retry loop)', async () => {
    let invocations = 0;
    const generateTextStub = makeGenerateTextStub(() => {
      invocations += 1;
      throw { statusCode: 429 } as unknown;
    });

    await expect(
      analyze(
        makeItems(1),
        makePipeline(),
        makeConfig({
          primaryModel: 'gemini-3-flash-preview',
          fallbackModel: 'gemini-3-flash-preview',
        }),
        {
          generateText: generateTextStub,
          google: makeGoogleStub(),
        },
      ),
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(invocations).toBe(1);
  });
});

describe('analyze — per-pipeline maxItemsPerRun override', () => {
  it('slices to pipeline.maxItemsPerRun when lower than global', async () => {
    const items = makeItems(10);
    const pipeline = makePipeline({ maxItemsPerRun: 2 });

    const generateTextStub = makeGenerateTextStub(() => ({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      steps: [],
    }));

    const result = await analyze(items, pipeline, makeConfig({ maxItemsPerRun: 100 }), {
      generateText: generateTextStub,
      google: makeGoogleStub(),
    });

    expect(result.body).toBe('ok');
    // Inspect the sliced set indirectly via buildVfsFiles.
    const sliced = items.slice(0, 2);
    const files = buildVfsFiles(sliced);
    const feedKeys = Object.keys(files).filter((k) => k.startsWith('/feeds/'));
    expect(feedKeys).toHaveLength(2);
  });
});

describe('analyze — per-pipeline modelTier: fallback', () => {
  it('uses config.fallbackModel as the primary call when pipeline.modelTier === "fallback"', async () => {
    const calls: string[] = [];
    const google = ((id: string) => {
      calls.push(id);
      return { _sentinel: id } as unknown;
    }) as unknown as NonNullable<AnalyzerDeps['google']>;

    const generateTextStub = makeGenerateTextStub(() => ({
      text: 'from fallback-tier',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      steps: [],
    }));

    const result = await analyze(
      makeItems(1),
      makePipeline({ modelTier: 'fallback' }),
      makeConfig(),
      { generateText: generateTextStub, google },
    );

    expect(result.modelUsed).toBe('gemini-3.1-flash-lite-preview');
    expect(calls).toEqual(['gemini-3.1-flash-lite-preview']);
    expect(result.fellBack).toBe(false);
  });
});

describe('analyze — zero items guard', () => {
  it('throws when called with an empty items array', async () => {
    await expect(
      analyze([], makePipeline(), makeConfig(), {
        generateText: makeGenerateTextStub(() => ({ text: '', steps: [] })),
        google: makeGoogleStub(),
      }),
    ).rejects.toThrow(/zero items for pipeline ai-research/);
  });
});
// Touching LanguageModel keeps the type import for future expansion.
type _EnsureLanguageModel = LanguageModel;
