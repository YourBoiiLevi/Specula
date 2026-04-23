import { Marked, Renderer } from 'marked';

export interface RenderedReportBody {
  html: string;
  excerpt: string;
  widgetCount: number;
  iframeCount: number;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderReportBody(markdown: string): RenderedReportBody {
  let widgetCount = 0;
  let iframeCount = 0;

  const renderer = new Renderer();
  const baseCode = renderer.code.bind(renderer);
  
  renderer.code = (token) => {
    const lang = (token.lang ?? '').trim().toLowerCase();
    const text = token.text ?? '';
    
    if (lang === 'html') {
      widgetCount++;
      return `<div class="report-visualization" data-specula-widget="1">${text}</div>`;
    }
    
    if (lang === 'iframe') {
      const url = text.trim().split(/\s+/)[0];
      if (!url || !/^https?:\/\//.test(url)) {
        return baseCode(token);
      }
      iframeCount++;
      const safe = escapeAttr(url);
      return `<div class="report-iframe"><iframe src="${safe}" sandbox="allow-scripts allow-same-origin allow-popups" loading="lazy" referrerpolicy="no-referrer" title="Embedded: ${safe}"></iframe></div>`;
    }
    
    return baseCode(token);
  };

  const markedInstance = new Marked({ gfm: true, breaks: false, renderer });
  const html = markedInstance.parse(markdown) as string;
  const excerpt = plainTextExcerpt(markdown, 300);

  return {
    html,
    excerpt,
    widgetCount,
    iframeCount,
  };
}

export function plainTextExcerpt(markdown: string, maxChars: number = 300): string {
  // Strip fenced code blocks
  let text = markdown.replace(/```[\s\S]*?```/g, '');
  // Strip inline code
  text = text.replace(/`[^`]*`/g, '');
  // Strip markdown images
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');
  // Replace links with just text
  text = text.replace(/\[([^\]]+)\]\(.*?\)/g, '$1');
  // Strip headings markers
  text = text.replace(/^#+\s+/gm, '');
  
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  if (text.length > maxChars) {
    const truncated = text.substring(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 0) {
      return truncated.substring(0, lastSpace) + '…';
    }
    return truncated + '…';
  }
  
  return text;
}
