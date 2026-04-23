import type { FeedGroup, FeedFetchResult } from '../types.js';

export interface FetchOptions {
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = 'Specula/1.0 (+https://github.com/YourBoiiLevi/Specula)';
const ACCEPT_HEADER =
  'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1';

interface ResolvedOptions {
  timeoutMs: number;
  userAgent: string;
  fetchImpl: typeof fetch;
}

export async function fetchFeeds(
  groups: FeedGroup[],
  options?: FetchOptions,
): Promise<FeedFetchResult[]> {
  const resolved: ResolvedOptions = {
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    userAgent: options?.userAgent ?? DEFAULT_USER_AGENT,
    fetchImpl: options?.fetchImpl ?? globalThis.fetch,
  };
  return Promise.all(groups.map((group) => fetchOne(group, resolved)));
}

async function fetchOne(group: FeedGroup, cfg: ResolvedOptions): Promise<FeedFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await cfg.fetchImpl(group.url, {
      headers: {
        'User-Agent': cfg.userAgent,
        Accept: ACCEPT_HEADER,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = `HTTP ${response.status}`;
      console.error(`[fetcher] ${group.id}: ${error}`);
      return { group, xml: null, error };
    }
    const xml = await response.text();
    const bytes = Buffer.byteLength(xml, 'utf8');
    console.log(`[fetcher] ${group.id}: ${bytes} bytes`);
    return { group, xml };
  } catch (err) {
    const error = controller.signal.aborted
      ? `timeout after ${cfg.timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    console.error(`[fetcher] ${group.id}: ${error}`);
    return { group, xml: null, error };
  } finally {
    clearTimeout(timer);
  }
}
