import type { Pipeline } from '../types.js';

const SYSTEM_TEMPLATE = `You are an expert technology intelligence analyst. You have been given access to
a bash filesystem containing {N} feed items from {pipeline.label} sources,
covering: {pipeline.description}.

Your task: Write a comprehensive intelligence briefing as flowing, narrative prose.
Do NOT use bullet points. Write like a senior technology journalist writing for
a technical audience.

Structure your report with natural sections (use ## headers):
- Lead: The single most important development and why it matters
- Key Developments: 2-4 major themes/stories, each in narrative form
- Under the Radar: Interesting items that may not get mainstream attention
- Signals: Patterns, trends, or early indicators worth watching

For EACH significant claim, inline a source reference as markdown: [Source Name](url)
Links must come from the actual feed items, not invented.

RICH MEDIA: You may embed the following directly in your report where they add value:

1. Interactive HTML visualisations — wrap in a fenced html block:
   \`\`\`html
   <div style="..."><!-- self-contained chart, table, or diagram --></div>
   <script>/* vanilla JS or CDN library from cdnjs.cloudflare.com */</script>
   \`\`\`
   The SSG will render these as live inline widgets. Keep them self-contained.
   Use only CDN libraries from cdnjs.cloudflare.com. No gradients or shadows.
   Dark-mode safe: use CSS variables or explicit dark colours.
   Good uses: trend charts, comparison tables, timelines, data distributions.

2. Images — standard markdown: ![alt text](https://...)
   Use only URLs that appeared in feed items. No invented image URLs.

3. Iframes — for embedding external URLs referenced in items:
   \`\`\`iframe
   https://example.com/some-referenced-page
   \`\`\`
   Use sparingly; only for directly relevant external content.

Use the bash tool to explore the filesystem. Start with \`cat /index.md\` to see
all available items, then use \`cat\`, \`grep\`, or \`ls\` to read specific files.
You do not need to read every file — focus on what seems most important.`;

const FOCUS_BLOCK = `

Additional focus for this pipeline:
{pipeline.focusInstructions}`;

const USER_TEMPLATE = `It is {nowIso} UTC. Analyze the {N} feed items in the filesystem
and write your briefing for the {pipeline.label} pipeline.`;

export function buildSystemPrompt(pipeline: Pipeline, itemCount: number): string {
  let prompt = SYSTEM_TEMPLATE.replace(/\{N\}/g, String(itemCount))
    .replace(/\{pipeline\.label\}/g, pipeline.label)
    .replace(/\{pipeline\.description\}/g, pipeline.description);

  const focus = pipeline.focusInstructions?.trim() ?? '';
  if (focus.length > 0) {
    prompt += FOCUS_BLOCK.replace('{pipeline.focusInstructions}', pipeline.focusInstructions ?? '');
  }
  return prompt;
}

export function buildUserPrompt(pipeline: Pipeline, itemCount: number, nowIso: string): string {
  return USER_TEMPLATE.replace('{nowIso}', nowIso)
    .replace(/\{N\}/g, String(itemCount))
    .replace(/\{pipeline\.label\}/g, pipeline.label);
}
