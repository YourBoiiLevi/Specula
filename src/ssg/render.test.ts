import { describe, it, expect } from 'vitest';
import { renderReportBody, plainTextExcerpt } from './render.js';

describe('renderReportBody', () => {
  it('renders basic markdown', () => {
    const result = renderReportBody('# Hello\n\nThis is a **test**.');
    expect(result.html).toContain('<h1>Hello</h1>');
    expect(result.html).toContain('<p>This is a <strong>test</strong>.</p>');
    expect(result.widgetCount).toBe(0);
    expect(result.iframeCount).toBe(0);
  });

  it('renders html fences as widgets', () => {
    const result = renderReportBody('```html\n<script>alert(1)</script>\n```');
    expect(result.html).toContain('<div class="report-visualization" data-specula-widget="1"><script>alert(1)</script></div>');
    expect(result.widgetCount).toBe(1);
  });

  it('renders iframe fences as iframes', () => {
    const result = renderReportBody('```iframe\nhttps://example.com\n```');
    expect(result.html).toContain('<div class="report-iframe"><iframe src="https://example.com" sandbox="allow-scripts allow-same-origin allow-popups" loading="lazy" referrerpolicy="no-referrer" title="Embedded: https://example.com"></iframe></div>');
    expect(result.iframeCount).toBe(1);
  });

  it('falls back to normal code block for invalid iframe url', () => {
    const result = renderReportBody('```iframe\nnot-a-url\n```');
    expect(result.html).toContain('<code class="language-iframe">not-a-url\n</code>');
    expect(result.iframeCount).toBe(0);
  });
});

describe('plainTextExcerpt', () => {
  it('strips code blocks, links, headings', () => {
    const md = `# Title\n\nSome text with a [link](https://example.com) and \`inline code\`.\n\n\`\`\`html\n<div></div>\n\`\`\`\n\n![image](img.png) More text.`;
    const excerpt = plainTextExcerpt(md);
    expect(excerpt).toBe('Title Some text with a link and . More text.');
  });

  it('truncates with ellipsis', () => {
    const md = 'A'.repeat(400);
    const excerpt = plainTextExcerpt(md, 300);
    expect(excerpt.length).toBeLessThanOrEqual(301);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});
