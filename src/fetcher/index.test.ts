import { describe, it, expect, vi } from 'vitest';
import type { FeedGroup } from '../types.js';
import { fetchFeeds } from './index.js';

type FetchFn = typeof fetch;

function groups(count: number): FeedGroup[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `feed-${i + 1}`,
    label: `Feed ${i + 1}`,
    url: `https://example.com/feed-${i + 1}.xml`,
  }));
}

describe('fetchFeeds', () => {
  it('returns xml for every group when all fetches succeed', async () => {
    const fetchImpl: FetchFn = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return new Response(`<rss><channel><title>${url}</title></channel></rss>`, { status: 200 });
    };

    const results = await fetchFeeds(groups(3), { fetchImpl });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.xml).toContain('<rss>');
      expect(r.error).toBeUndefined();
    }
  });

  it('returns HTTP {status} error for non-2xx responses without affecting siblings', async () => {
    const fetchImpl: FetchFn = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('feed-2.xml')) {
        return new Response('boom', { status: 500 });
      }
      return new Response('<rss/>', { status: 200 });
    };

    const results = await fetchFeeds(groups(3), { fetchImpl });
    expect(results).toHaveLength(3);

    const byId = new Map(results.map((r) => [r.group.id, r]));
    expect(byId.get('feed-1')?.xml).toBe('<rss/>');
    expect(byId.get('feed-1')?.error).toBeUndefined();
    expect(byId.get('feed-2')?.xml).toBeNull();
    expect(byId.get('feed-2')?.error).toBe('HTTP 500');
    expect(byId.get('feed-3')?.xml).toBe('<rss/>');
    expect(byId.get('feed-3')?.error).toBeUndefined();
  });

  it('releases non-OK response bodies before returning', async () => {
    const cancel = vi.fn<() => Promise<void>>().mockResolvedValue();
    const fetchImpl: FetchFn = async () =>
      ({
        ok: false,
        status: 503,
        bodyUsed: false,
        body: { cancel } as unknown as ReadableStream<Uint8Array>,
      }) as Response;

    const [result] = await fetchFeeds(groups(1), { fetchImpl });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result?.xml).toBeNull();
    expect(result?.error).toBe('HTTP 503');
  });

  it('aborts and reports timeout when the fetch never resolves', async () => {
    const fetchImpl: FetchFn = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });

    const start = Date.now();
    const results = await fetchFeeds(groups(1), { fetchImpl, timeoutMs: 50 });
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(1);
    expect(results[0]?.xml).toBeNull();
    expect(results[0]?.error).toBe('timeout after 50ms');
    // Confirm we actually settled promptly rather than hanging on the stub.
    expect(elapsed).toBeLessThan(2000);
  });

  it('passes a custom User-Agent through to the fetch impl', async () => {
    const captured: Array<Record<string, string>> = [];
    const fetchImpl: FetchFn = async (_input, init) => {
      const headers = new Headers(init?.headers);
      const snap: Record<string, string> = {};
      headers.forEach((value, key) => {
        snap[key.toLowerCase()] = value;
      });
      captured.push(snap);
      return new Response('<rss/>', { status: 200 });
    };

    await fetchFeeds(groups(1), { fetchImpl, userAgent: 'CustomUA/9.9' });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.['user-agent']).toBe('CustomUA/9.9');
    expect(captured[0]?.accept).toContain('application/rss+xml');
  });

  it('defaults User-Agent to Specula/1.0 when none is provided', async () => {
    const captured: Array<Record<string, string>> = [];
    const fetchImpl: FetchFn = async (_input, init) => {
      const headers = new Headers(init?.headers);
      const snap: Record<string, string> = {};
      headers.forEach((value, key) => {
        snap[key.toLowerCase()] = value;
      });
      captured.push(snap);
      return new Response('<rss/>', { status: 200 });
    };

    await fetchFeeds(groups(1), { fetchImpl });
    expect(captured[0]?.['user-agent']).toMatch(/^Specula\/1\.0/);
    expect(captured[0]?.['user-agent']).toContain('github.com/YourBoiiLevi/Specula');
  });
});
