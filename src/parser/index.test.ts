import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeedFetchResult, FeedGroup } from '../types.js';
import { parseFeed, parseFeeds, parseFeedDate, stripHtml } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rssGroup: FeedGroup = {
  id: 'rss-sample',
  label: 'Sample RSS',
  url: 'https://example.com/rss',
};

const atomGroup: FeedGroup = {
  id: 'atom-sample',
  label: 'Sample Atom',
  url: 'https://example.com/atom',
};

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function rssResult(): FeedFetchResult {
  return { group: rssGroup, xml: loadFixture('rss-sample.xml') };
}

function atomResult(): FeedFetchResult {
  return { group: atomGroup, xml: loadFixture('atom-sample.xml') };
}

describe('parseFeed (RSS)', () => {
  const items = parseFeed(rssResult());

  it('returns all three RSS items', () => {
    expect(items).toHaveLength(3);
  });

  it('extracts titles correctly', () => {
    expect(items.map((i) => i.title)).toEqual(['First Post', 'Second Post', 'Third Post']);
  });

  it('strips HTML tags and decodes entities in content', () => {
    expect(items[0]?.content).toBe('Hello world');
    expect(items[1]?.content).toBe('Longer content with a link inside.');
    // Item 3 had &amp; &lt;tags&gt; in source — fxp decodes them, then stripHtml removes <tags>.
    expect(items[2]?.content).not.toContain('&amp;');
    expect(items[2]?.content).toContain('&');
    expect(items[2]?.content).toContain('ampersand');
  });

  it('parses publishedAt as a Date', () => {
    expect(items[0]?.publishedAt).toBeInstanceOf(Date);
    expect(items[0]?.publishedAt.toISOString()).toBe('2026-04-23T12:00:00.000Z');
    expect(items[1]?.publishedAt.toISOString()).toBe('2026-04-22T09:30:00.000Z');
    expect(items[2]?.publishedAt.toISOString()).toBe('2026-04-21T06:15:00.000Z');
  });

  it('resolves id in priority order: guid > link > hash', () => {
    expect(items[0]?.id).toBe('rss-item-1-guid');
    // Item 2 has no guid → falls back to link.
    expect(items[1]?.id).toBe('https://example.com/rss/2');
    // Item 3's guid is an object with isPermaLink="false" — the text is the id.
    expect(items[2]?.id).toBe('rss-item-3-guid-nonpermalink');
  });

  it('populates source label and sourceUrl from the group', () => {
    for (const item of items) {
      expect(item.source).toBe('Sample RSS');
      expect(item.sourceUrl).toBe('https://example.com/rss');
    }
  });

  it('exposes the link for each item', () => {
    expect(items[0]?.link).toBe('https://example.com/rss/1');
    expect(items[1]?.link).toBe('https://example.com/rss/2');
    expect(items[2]?.link).toBe('https://example.com/rss/3');
  });
});

describe('parseFeed (Atom)', () => {
  const entries = parseFeed(atomResult());

  it('returns both Atom entries', () => {
    expect(entries).toHaveLength(2);
  });

  it('extracts link.href when link is an object', () => {
    expect(entries[0]?.link).toBe('https://example.com/atom/1');
  });

  it('prefers rel="alternate" when link is an array', () => {
    expect(entries[1]?.link).toBe('https://example.com/atom/2');
  });

  it('extracts Atom content and summary', () => {
    expect(entries[0]?.content).toBe('Atom body content.');
    expect(entries[1]?.content).toBe('Just a summary text.');
  });

  it('uses entry.id when present', () => {
    expect(entries[0]?.id).toBe('tag:example.com,2026:atom/1');
    expect(entries[1]?.id).toBe('tag:example.com,2026:atom/2');
  });

  it('parses published date', () => {
    expect(entries[0]?.publishedAt.toISOString()).toBe('2026-04-23T08:00:00.000Z');
    expect(entries[1]?.publishedAt.toISOString()).toBe('2026-04-22T15:30:00.000Z');
  });
});

describe('parseFeeds', () => {
  it('merges feeds and sorts newest-first', () => {
    const all = parseFeeds([rssResult(), atomResult()]);
    expect(all).toHaveLength(5);
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i]!.publishedAt.getTime();
      const b = all[i + 1]!.publishedAt.getTime();
      expect(a).toBeGreaterThanOrEqual(b);
    }
    // Newest entry is the RSS First Post at 2026-04-23T12:00:00Z.
    expect(all[0]?.title).toBe('First Post');
  });

  it('skips entries where xml is null', () => {
    const all = parseFeeds([
      { group: rssGroup, xml: null, error: 'HTTP 500' },
      atomResult(),
    ]);
    expect(all).toHaveLength(2);
  });
});

describe('error handling', () => {
  it('returns [] when xml is null', () => {
    expect(parseFeed({ group: rssGroup, xml: null })).toEqual([]);
  });

  it('returns [] on invalid XML without throwing', () => {
    expect(parseFeed({ group: rssGroup, xml: '<<<not xml>>>' })).toEqual([]);
  });

  it('returns [] on XML that has no rss/rdf/feed root', () => {
    expect(parseFeed({ group: rssGroup, xml: '<html><body>hi</body></html>' })).toEqual([]);
  });
});

describe('parseFeedDate', () => {
  it('parses RFC-2822 dates', () => {
    const d = parseFeedDate('Wed, 23 Apr 2026 12:00:00 GMT');
    expect(d).not.toBeNull();
    expect(d?.toISOString()).toBe('2026-04-23T12:00:00.000Z');
  });

  it('returns null for invalid input', () => {
    expect(parseFeedDate('not a date')).toBeNull();
    expect(parseFeedDate('')).toBeNull();
  });
});

describe('stripHtml', () => {
  it('removes tags and decodes entities', () => {
    expect(stripHtml('<p>Hello <b>world</b> &amp; goodbye</p>')).toBe('Hello world & goodbye');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('<p>foo  \n\t bar</p>')).toBe('foo bar');
  });

  it('handles empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('decodes &lt; &gt; &quot; &#39; &nbsp;', () => {
    expect(stripHtml('&lt;tag&gt; &quot;q&quot; &#39;a&#39; &nbsp;x')).toBe('<tag> "q" \'a\' x');
  });
});
