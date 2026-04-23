// Generate a demo site from synthetic reports for visual verification.
// Not a test — just a local smoke check.
import { generate } from '../src/ssg/index.js';
import type { Report, SpeculaConfig } from '../src/types.js';

const config: SpeculaConfig = {
  intervalHours: 1,
  primaryModel: 'gemini-3-flash-preview',
  fallbackModel: 'gemini-3.1-flash-lite-preview',
  thinkingLevel: 'low',
  maxItemsPerRun: 100,
  dedupWindowHours: 48,
  siteRepoPath: './specula-site',
  githubPagesUrl: 'https://example.github.io/specula',
  feedTitle: 'SPECULA',
  feedDescription: 'AI-synthesized intelligence briefings from curated feeds',
  configUiPort: 3001,
  pipelines: [
    { id: 'ai-research', label: 'AI Research', description: 'Frontier AI papers and releases', feedGroups: [] },
    { id: 'dev-tools', label: 'Dev Tools & Infra', description: 'Developer tooling and open source', feedGroups: [] },
  ],
};

const body1 = `## The week agentic browsers broke out

This week's headline is the rapid rise of agentic browser frameworks. [Anthropic shipped Claude for Chrome](https://example.com/claude-chrome), a skills-based extension that lets the assistant directly navigate pages, while [Perplexity's Comet](https://example.com/comet) deepened its research integrations. Both products push the same thesis: an always-on assistant grounded in the user's live browsing context outperforms a chat sidebar.

## Key Developments

OpenAI is rumored to be close to a [GPT-5.5 release](https://example.com/gpt55), while Google's [Gemini 3.1 Pro preview](https://example.com/gemini31) expanded to 2M tokens in AI Studio.

\`\`\`html
<div style="padding:12px;border:1px solid #333;background:#111;color:#e8e8e8;font-family:monospace">
  <div style="font-size:12px;color:#7c5cff;margin-bottom:8px">COMPUTE vs CONTEXT (Gemini series)</div>
  <div style="display:grid;grid-template-columns:100px 1fr 80px;gap:4px;font-size:13px">
    <div>2.5 Pro</div><div style="background:#7c5cff;height:14px;width:30%"></div><div>1M</div>
    <div>3 Flash</div><div style="background:#7c5cff;height:14px;width:50%"></div><div>1M</div>
    <div>3.1 Pro</div><div style="background:#3ddc97;height:14px;width:100%"></div><div>2M</div>
  </div>
</div>
\`\`\`

## Under the Radar

A small but telling detail: the release cadence on agentic coding assistants has moved from quarterly to weekly. Infrastructure is re-consolidating.

## Signals

Expect a flurry of browser-native agent experiments over the next month. Watch for one of the big three to fold an agent into their default search UI.`;

const body2 = `## Rust tooling is quietly eating Node

The most interesting dev-tools story of the week is how many Node-based CLI tools are being rewritten in Rust — not for marketing but because the performance and startup deltas have become embarrassing. See [Biome 3.0](https://example.com/biome3), [Oxc-lint](https://example.com/oxc), and the [Moon 2 build graph](https://example.com/moon2) release notes.

## Key Developments

The shift has been years in the making but this week feels like a tipping point. ESLint plugins now routinely get Rust reimplementations within weeks of popularity. The bundler space, post-Turbopack, is now also overwhelmingly Rust.`;

const reports: Report[] = [
  {
    id: 'ai-research-2026-04-23-12-00',
    pipelineId: 'ai-research',
    pipelineLabel: 'AI Research',
    generatedAt: '2026-04-23T12:00:00.000Z',
    itemCount: 18,
    modelUsed: 'gemini-3-flash-preview',
    sources: [
      { label: 'arXiv CS.AI', url: 'http://localhost:1200/arxiv/search?query=cs.AI' },
      { label: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml' },
    ],
    body: body1,
    wordCount: body1.split(/\s+/).length,
  },
  {
    id: 'ai-research-2026-04-22-12-00',
    pipelineId: 'ai-research',
    pipelineLabel: 'AI Research',
    generatedAt: '2026-04-22T12:00:00.000Z',
    itemCount: 14,
    modelUsed: 'gemini-3.1-flash-lite-preview',
    sources: [
      { label: 'arXiv CS.AI', url: 'http://localhost:1200/arxiv/search?query=cs.AI' },
    ],
    body: `## Weekend roundup\n\nQuieter weekend. A few interesting [arXiv preprints](https://example.com/arxiv) on sparse attention caught the eye.`,
    wordCount: 20,
  },
  {
    id: 'dev-tools-2026-04-23-12-30',
    pipelineId: 'dev-tools',
    pipelineLabel: 'Dev Tools & Infra',
    generatedAt: '2026-04-23T12:30:00.000Z',
    itemCount: 22,
    modelUsed: 'gemini-3-flash-preview',
    sources: [
      { label: 'GitHub Trending', url: 'http://localhost:1200/github/trending/daily/any' },
      { label: 'Hacker News', url: 'http://localhost:1200/hackernews/best' },
    ],
    body: body2,
    wordCount: body2.split(/\s+/).length,
  },
];

const result = await generate(config, { outDir: './site-demo', reports });
console.log(JSON.stringify(result, null, 2));
