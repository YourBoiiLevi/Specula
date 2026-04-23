import 'dotenv/config';
import { analyze } from '../src/analyzer/index.js';
import type { FeedItem, Pipeline, SpeculaConfig } from '../src/types.js';

async function main(): Promise<void> {
  if (!process.env['GOOGLE_GENERATIVE_AI_API_KEY']) {
    console.log('Set GOOGLE_GENERATIVE_AI_API_KEY in .env to run this script');
    return;
  }

  const now = new Date();
  const items: FeedItem[] = [
    {
      id: 'ai-news-1',
      title: 'OpenAI details training-time safety mitigations in new technical report',
      link: 'https://example.com/openai-safety',
      content:
        'OpenAI published a new technical report outlining the training-time safety mitigations it applied to its latest frontier model. The report covers supervised fine-tuning regimes, RLHF preference data composition, and the expanded red-team program that produced the final evaluations cited in the system card.',
      publishedAt: new Date(now.getTime() - 60 * 60 * 1000),
      source: 'Example AI News',
      sourceUrl: 'https://example.com/feed',
    },
    {
      id: 'ai-news-2',
      title: 'Anthropic releases paper on interpretability for long-context reasoning',
      link: 'https://example.com/anthropic-interp',
      content:
        'Anthropic researchers released a paper studying how sparse autoencoders scale to long-context reasoning traces. The work extends earlier feature-attribution techniques and reports experiments on 100k-token synthetic tasks, finding that certain abstract features remain stable across context windows.',
      publishedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      source: 'Example Research Wire',
      sourceUrl: 'https://example.com/feed',
    },
    {
      id: 'ai-news-3',
      title: 'Google DeepMind demos agentic coding benchmark at internal summit',
      link: 'https://example.com/dm-coding',
      content:
        'At an internal summit this week, Google DeepMind presented results from a new agentic coding benchmark focused on multi-step refactors inside large monorepos. Early numbers suggest meaningful gains over prior baselines when the agent is allowed to read a virtual filesystem and run tests between steps.',
      publishedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      source: 'Example Dev News',
      sourceUrl: 'https://example.com/feed',
    },
  ];

  const pipeline: Pipeline = {
    id: 'ai-research-smoke',
    label: 'AI Research',
    description: 'recent frontier-lab research and agentic tooling news',
    feedGroups: [{ id: 'ex', label: 'Example', url: 'https://example.com/feed' }],
  };

  const config: SpeculaConfig = {
    intervalHours: 1,
    primaryModel: 'gemini-3-flash-preview',
    fallbackModel: 'gemini-3.1-flash-lite-preview',
    thinkingLevel: 'low',
    maxItemsPerRun: 5,
    dedupWindowHours: 48,
    siteRepoPath: './site',
    githubPagesUrl: 'https://example.com',
    feedTitle: 'Test',
    feedDescription: 'Test smoke run',
    configUiPort: 3001,
    pipelines: [pipeline],
  };

  try {
    const result = await analyze(items, pipeline, config);
    console.log('--- analyzer result ---');
    console.log('model used:', result.modelUsed);
    console.log('fell back:', result.fellBack);
    console.log('steps:', result.steps);
    console.log('tool calls:', result.toolCalls);
    console.log('usage:', result.usage);
    console.log('--- body ---');
    console.log(result.body);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

void main();
