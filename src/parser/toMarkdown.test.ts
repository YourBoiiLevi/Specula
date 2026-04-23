import { describe, it, expect } from 'vitest';
import type { FeedItem } from '../types.js';
import { itemToMarkdown } from './toMarkdown.js';

describe('itemToMarkdown', () => {
  const item: FeedItem = {
    id: 'sample-id',
    title: 'Sample Title',
    link: 'https://example.com/article',
    content: 'This is the body of the article.',
    publishedAt: new Date('2026-04-23T12:34:56Z'),
    source: 'Sample Source',
    sourceUrl: 'https://example.com/feed',
  };

  it('produces the exact required format', () => {
    const expected = [
      '## Sample Title',
      '**Source**: Sample Source | **Published**: 2026-04-23T12:34:56.000Z',
      '**Link**: https://example.com/article',
      '',
      'This is the body of the article.',
    ].join('\n');
    expect(itemToMarkdown(item)).toBe(expected);
  });

  it('is idempotently trimmed', () => {
    const result = itemToMarkdown({ ...item, content: 'body   ' });
    expect(result).toBe(result.trim());
    expect(result.endsWith('body')).toBe(true);
  });
});
