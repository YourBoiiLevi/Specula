import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import type { FeedGroup, FeedItem, FeedFetchResult } from '../types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: false,
  cdataPropName: '__cdata',
});

// Narrow `any`-style cast: fast-xml-parser returns `any`, so we widen the root
// to `unknown` and then narrow via isObject / toArray guards below. No `any` is
// retained in this module beyond the return value of parser.parse itself.
type UnknownRecord = Record<string, unknown>;

function isRecord(x: unknown): x is UnknownRecord {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function getText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (isRecord(node)) {
    const cdata = node['__cdata'];
    if (typeof cdata === 'string') return cdata;
    const text = node['#text'];
    if (typeof text === 'string') return text;
    if (typeof text === 'number' || typeof text === 'boolean') return String(text);
  }
  return '';
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function stripHtml(input: string): string {
  if (!input) return '';
  const noTags = input.replace(/<[^>]+>/g, '');
  const decoded = noTags.replace(
    /&(?:amp|lt|gt|quot|nbsp|#39);/g,
    (match) => ENTITY_MAP[match] ?? match,
  );
  return decoded.replace(/\s+/g, ' ').trim();
}

export function parseFeedDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function hashId(title: string, isoPub: string): string {
  return createHash('sha1').update(`${title}|${isoPub}`).digest('hex');
}

function chooseId(primary: string, fallback: string, title: string, isoPub: string): string {
  if (primary) return primary;
  if (fallback) return fallback;
  return hashId(title, isoPub);
}

function getRssLink(item: UnknownRecord): string {
  return getText(item['link']);
}

function getAtomLink(entry: UnknownRecord): string {
  const link = entry['link'];
  if (typeof link === 'string') return link;
  if (Array.isArray(link)) {
    for (const candidate of link) {
      if (isRecord(candidate) && candidate['rel'] === 'alternate') {
        const href = candidate['href'];
        if (typeof href === 'string') return href;
      }
    }
    const first = link[0];
    if (typeof first === 'string') return first;
    if (isRecord(first) && typeof first['href'] === 'string') return first['href'];
    return '';
  }
  if (isRecord(link) && typeof link['href'] === 'string') return link['href'];
  return '';
}

function getRssGuid(item: UnknownRecord): string {
  const guid = item['guid'];
  if (typeof guid === 'string') return guid;
  if (isRecord(guid)) {
    const text = guid['#text'];
    if (typeof text === 'string') return text;
  }
  return '';
}

function getRssContent(item: UnknownRecord): string {
  const encoded = getText(item['content:encoded']);
  if (encoded) return encoded;
  return getText(item['description']);
}

function getAtomContent(entry: UnknownRecord): string {
  const c = entry['content'];
  if (typeof c === 'string') return c;
  if (isRecord(c)) {
    const cdata = c['__cdata'];
    if (typeof cdata === 'string') return cdata;
    const text = c['#text'];
    if (typeof text === 'string') return text;
  }
  return getText(entry['summary']);
}

function getRssDate(item: UnknownRecord): string {
  return getText(item['pubDate']) || getText(item['dc:date']);
}

function getAtomDate(entry: UnknownRecord): string {
  return getText(entry['published']) || getText(entry['updated']);
}

function normalizeRssItem(item: UnknownRecord, group: FeedGroup): FeedItem {
  const title = getText(item['title']);
  const link = getRssLink(item);
  const rawDate = getRssDate(item);
  const publishedAt = parseFeedDate(rawDate) ?? new Date();
  const isoPub = publishedAt.toISOString();
  const guid = getRssGuid(item);
  const id = chooseId(guid, link, title, isoPub);
  const content = stripHtml(getRssContent(item));
  return {
    id,
    title,
    link,
    content,
    publishedAt,
    source: group.label,
    sourceUrl: group.url,
  };
}

function normalizeAtomEntry(entry: UnknownRecord, group: FeedGroup): FeedItem {
  const title = getText(entry['title']);
  const link = getAtomLink(entry);
  const rawDate = getAtomDate(entry);
  const publishedAt = parseFeedDate(rawDate) ?? new Date();
  const isoPub = publishedAt.toISOString();
  const atomId = getText(entry['id']);
  const id = chooseId(atomId, link, title, isoPub);
  const content = stripHtml(getAtomContent(entry));
  return {
    id,
    title,
    link,
    content,
    publishedAt,
    source: group.label,
    sourceUrl: group.url,
  };
}

export function parseFeed(result: FeedFetchResult): FeedItem[] {
  if (result.xml == null) return [];
  let root: unknown;
  try {
    // parser.parse is typed as `any`; we immediately widen to unknown for safety.
    root = parser.parse(result.xml) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[parser] ${result.group.id}: failed to parse XML — ${msg}`);
    return [];
  }
  if (!isRecord(root)) return [];

  const rss = root['rss'];
  if (isRecord(rss)) {
    const channel = rss['channel'];
    if (isRecord(channel)) {
      const items = toArray(channel['item']).filter(isRecord);
      return items.map((item) => normalizeRssItem(item, result.group));
    }
  }

  const rdf = root['rdf:RDF'];
  if (isRecord(rdf)) {
    const items = toArray(rdf['item']).filter(isRecord);
    return items.map((item) => normalizeRssItem(item, result.group));
  }

  const feed = root['feed'];
  if (isRecord(feed)) {
    const entries = toArray(feed['entry']).filter(isRecord);
    return entries.map((entry) => normalizeAtomEntry(entry, result.group));
  }

  return [];
}

export function parseFeeds(results: FeedFetchResult[]): FeedItem[] {
  const all = results.flatMap((r) => (r.xml != null ? parseFeed(r) : []));
  return all.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
