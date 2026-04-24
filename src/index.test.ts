import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type AddressInfo } from 'node:net';
import { boot } from './index.js';
import { clearStatus, mergeStatus } from './status/index.js';
import type { SpeculaConfig } from './types.js';

function makeConfig(port: number): SpeculaConfig {
  return {
    intervalHours: 1,
    primaryModel: 'primary',
    fallbackModel: 'fallback',
    thinkingLevel: 'low',
    maxItemsPerRun: 10,
    dedupWindowHours: 48,
    siteRepoPath: './site',
    githubPagesUrl: 'https://example.com/specula',
    feedTitle: 'Specula',
    feedDescription: 'Test',
    configUiPort: port,
    pipelines: [
      {
        id: 'alpha',
        label: 'Alpha',
        description: 'Alpha pipeline',
        feedGroups: [{ id: 'g1', label: 'G1', url: 'https://example.com/a.xml' }],
      },
      {
        id: 'beta',
        label: 'Beta',
        description: 'Beta pipeline',
        feedGroups: [{ id: 'g2', label: 'G2', url: 'https://example.com/b.xml' }],
      },
    ],
  };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

describe('boot', () => {
  beforeEach(() => {
    clearStatus();
  });

  afterEach(() => {
    clearStatus();
  });

  it('loads config, starts scheduler, boots config-ui server, and wires manual triggers', async () => {
    const port = await findFreePort();
    const config = makeConfig(port);
    const runPipeline = vi.fn(async () => ({ run: {} as never }));

    const result = await boot({
      configPath: '/tmp/specula-test-config.json',
      loadConfig: () => config,
      saveConfig: async () => {},
      runPipeline: runPipeline as never,
    });

    try {
      expect(result.port).toBe(port);
      expect(result.scheduler.getSchedule().map((e) => e.pipelineId)).toEqual(['alpha', 'beta']);
      expect(result.scheduler.getSchedule().map((e) => e.offsetMinutes)).toEqual([0, 30]);

      // HTTP endpoint reachable.
      const res = await fetch(`http://127.0.0.1:${port}/api/config`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { config: SpeculaConfig };
      expect(body.config.pipelines.map((p) => p.id)).toEqual(['alpha', 'beta']);

      // Status endpoint uses config-ordered pipeline ids.
      mergeStatus('alpha', { lastRunStatus: 'success', lastItemCount: 3 });
      const statusRes = await fetch(`http://127.0.0.1:${port}/api/status`);
      expect(statusRes.status).toBe(200);
      const statusBody = (await statusRes.json()) as {
        pipelines: { pipelineId: string; lastRunStatus: string }[];
      };
      expect(statusBody.pipelines.map((p) => p.pipelineId)).toEqual(['alpha', 'beta']);

      // Manual trigger dispatches through scheduler → runPipeline.
      const runRes = await fetch(`http://127.0.0.1:${port}/api/run/alpha`, { method: 'POST' });
      expect(runRes.status).toBe(202);
      // Give the fire-and-forget trigger a tick to land.
      await new Promise((r) => setTimeout(r, 20));
      expect(runPipeline).toHaveBeenCalledTimes(1);
      expect(runPipeline.mock.calls[0]?.[1]).toMatchObject({ id: 'alpha' });
    } finally {
      await result.shutdown();
    }
  });

  it('fails fast when pipeline count is not a factor of 60', async () => {
    const port = await findFreePort();
    const config = makeConfig(port);
    config.pipelines = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      label: `P${i}`,
      description: 'bad',
      feedGroups: [{ id: 'g', label: 'G', url: 'https://example.com/x.xml' }],
    }));

    await expect(
      boot({
        configPath: '/tmp/specula-test-config.json',
        loadConfig: () => config,
        saveConfig: async () => {},
        runPipeline: (async () => ({})) as never,
      }),
    ).rejects.toThrow(/factor of 60/);
  });
});
