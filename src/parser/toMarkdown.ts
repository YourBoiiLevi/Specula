import type { FeedItem } from '../types.js';

export function itemToMarkdown(item: FeedItem): string {
  const lines = [
    `## ${item.title}`,
    `**Source**: ${item.source} | **Published**: ${item.publishedAt.toISOString()}`,
    `**Link**: ${item.link}`,
    '',
    item.content,
  ];
  return lines.join('\n').trim();
}
