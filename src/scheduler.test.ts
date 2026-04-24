import { describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from 'node-cron';
import type { Pipeline, SpeculaConfig } from './types.js';
import {
  buildSchedule,
  createScheduler,
  validatePipelineCount,
  type CronLike,
  type SchedulerLogger,
} from './scheduler.js';

function makePipeline(id: string): Pipeline {
  return {
    id,
    label: `Pipeline ${id}`,
    description: `Desc ${id}`,
    feedGroups: [{ id: `${id}-one`, label: 'Group', url: 'https://example.com/feed.xml' }],
  };
}

function makeConfig(pipelineIds: string[]): SpeculaConfig {
  return {
    intervalHours: 1,
    primaryModel: 'p',
    fallbackModel: 'f',
    thinkingLevel: 'low',
    maxItemsPerRun: 10,
    dedupWindowHours: 48,
    siteRepoPath: './site',
    githubPagesUrl: 'https://example.com/specula',
    feedTitle: 'Specula',
    feedDescription: 'Test',
    configUiPort: 3001,
    pipelines: pipelineIds.map(makePipeline),
  };
}

interface FakeTask extends ScheduledTask {
  expression: string;
  fn: () => void | Promise<void>;
  stopped: boolean;
}

function createFakeCron(): { cron: CronLike; tasks: FakeTask[] } {
  const tasks: FakeTask[] = [];
  const cron: CronLike = {
    schedule(expression, fn, options) {
      const task: FakeTask = {
        id: `fake-${tasks.length}`,
        ...(options?.name !== undefined ? { name: options.name } : {}),
        expression,
        fn,
        stopped: false,
        start() {},
        stop() {
          this.stopped = true;
        },
        getStatus() {
          return this.stopped ? 'stopped' : 'scheduled';
        },
        destroy() {},
        async execute() {
          return await fn();
        },
        getNextRun() {
          return null;
        },
        on() {},
        off() {},
        once() {},
      };
      tasks.push(task);
      return task;
    },
  };
  return { cron, tasks };
}

function silentLogger(): SchedulerLogger & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    info: (m) => logs.push(`info: ${m}`),
    warn: (m) => logs.push(`warn: ${m}`),
    error: (m) => logs.push(`error: ${m}`),
  };
}

describe('validatePipelineCount', () => {
  it('accepts all factors of 60', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) {
      expect(() => validatePipelineCount(n)).not.toThrow();
    }
  });

  it('rejects non-factors of 60', () => {
    for (const n of [7, 8, 9, 11, 13, 45]) {
      expect(() => validatePipelineCount(n)).toThrow(/factor of 60/);
    }
  });

  it('rejects zero and negative', () => {
    expect(() => validatePipelineCount(0)).toThrow();
    expect(() => validatePipelineCount(-1)).toThrow();
  });
});

describe('buildSchedule', () => {
  it('produces evenly spaced offsets', () => {
    const entries = buildSchedule([makePipeline('a'), makePipeline('b'), makePipeline('c')]);
    expect(entries).toEqual([
      { pipelineId: 'a', offsetMinutes: 0, cronExpression: '0 * * * *' },
      { pipelineId: 'b', offsetMinutes: 20, cronExpression: '20 * * * *' },
      { pipelineId: 'c', offsetMinutes: 40, cronExpression: '40 * * * *' },
    ]);
  });

  it('throws on non-factor-of-60 pipeline counts', () => {
    const pipelines = Array.from({ length: 7 }, (_, i) => makePipeline(`p${i}`));
    expect(() => buildSchedule(pipelines)).toThrow(/factor of 60/);
  });
});

describe('createScheduler', () => {
  it('registers one cron task per pipeline with correct offset and name', () => {
    const { cron, tasks } = createFakeCron();
    const config = makeConfig(['a', 'b']);
    const scheduler = createScheduler({
      cron,
      getConfig: () => config,
      runPipeline: vi.fn(async () => {}),
      logger: silentLogger(),
    });

    scheduler.start();

    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.expression).toBe('0 * * * *');
    expect(tasks[1]?.expression).toBe('30 * * * *');
    expect(tasks[0]?.name).toBe('specula:a');
    expect(tasks[1]?.name).toBe('specula:b');
    expect(scheduler.getSchedule()).toEqual([
      { pipelineId: 'a', offsetMinutes: 0, cronExpression: '0 * * * *' },
      { pipelineId: 'b', offsetMinutes: 30, cronExpression: '30 * * * *' },
    ]);
  });

  it('throws at start() if pipeline count is not a factor of 60', () => {
    const { cron } = createFakeCron();
    const ids = Array.from({ length: 7 }, (_, i) => `p${i}`);
    const scheduler = createScheduler({
      cron,
      getConfig: () => makeConfig(ids),
      runPipeline: vi.fn(async () => {}),
      logger: silentLogger(),
    });
    expect(() => scheduler.start()).toThrow(/factor of 60/);
  });

  it('invokes runPipeline with the correct config + pipeline when cron fires', async () => {
    const { cron, tasks } = createFakeCron();
    const config = makeConfig(['a']);
    const runPipeline = vi.fn(async () => {});
    const scheduler = createScheduler({
      cron,
      getConfig: () => config,
      runPipeline,
      logger: silentLogger(),
    });
    scheduler.start();

    await tasks[0]!.fn();
    // Drain the active mutex: runPipeline is awaited inside runOne.
    await new Promise((r) => setImmediate(r));

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(runPipeline.mock.calls[0]?.[0]).toBe(config);
    expect(runPipeline.mock.calls[0]?.[1]).toMatchObject({ id: 'a' });
  });

  it('per-pipeline mutex: concurrent triggers for the same pipeline skip the second', async () => {
    const { cron } = createFakeCron();
    const config = makeConfig(['a']);
    let resolveRun!: () => void;
    const running = new Promise<void>((r) => {
      resolveRun = r;
    });
    const runPipeline = vi.fn(async () => {
      await running;
    });
    const logger = silentLogger();
    const scheduler = createScheduler({
      cron,
      getConfig: () => config,
      runPipeline,
      logger,
    });
    scheduler.start();

    const first = scheduler.trigger('a');
    const second = scheduler.trigger('a');
    expect(scheduler.getActiveRuns()).toContain('a');

    resolveRun();
    await Promise.all([first, second]);

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(logger.logs.some((l) => /already running/.test(l))).toBe(true);
    expect(scheduler.getActiveRuns()).toEqual([]);
  });

  it('skips scheduled runs when the pipeline is no longer in config', async () => {
    const { cron, tasks } = createFakeCron();
    let config = makeConfig(['a', 'b']);
    const runPipeline = vi.fn(async () => {});
    const scheduler = createScheduler({
      cron,
      getConfig: () => config,
      runPipeline,
      logger: silentLogger(),
    });
    scheduler.start();

    const aTask = tasks.find((t) => t.name === 'specula:a');
    expect(aTask).toBeDefined();

    config = makeConfig(['b', 'c']);
    await aTask!.fn();
    await new Promise((r) => setImmediate(r));

    expect(runPipeline).not.toHaveBeenCalled();
  });

  it('stop() stops every registered task', () => {
    const { cron, tasks } = createFakeCron();
    const scheduler = createScheduler({
      cron,
      getConfig: () => makeConfig(['a', 'b']),
      runPipeline: vi.fn(async () => {}),
      logger: silentLogger(),
    });
    scheduler.start();
    scheduler.stop();
    expect(tasks.every((t) => t.stopped)).toBe(true);
  });

  it('reload() re-registers cron tasks with the new config', () => {
    const { cron, tasks } = createFakeCron();
    let config = makeConfig(['a', 'b']);
    const scheduler = createScheduler({
      cron,
      getConfig: () => config,
      runPipeline: vi.fn(async () => {}),
      logger: silentLogger(),
    });
    scheduler.start();
    expect(tasks).toHaveLength(2);

    // Config changes: 3 pipelines instead of 2.
    config = makeConfig(['x', 'y', 'z']);
    scheduler.reload();

    // Old tasks stopped, new ones added.
    expect(tasks.slice(0, 2).every((t) => t.stopped)).toBe(true);
    expect(tasks).toHaveLength(5);
    expect(scheduler.getSchedule().map((e) => e.pipelineId)).toEqual(['x', 'y', 'z']);
    expect(scheduler.getSchedule().map((e) => e.offsetMinutes)).toEqual([0, 20, 40]);
  });

  it('records runPipeline errors without throwing', async () => {
    const { cron } = createFakeCron();
    const logger = silentLogger();
    const scheduler = createScheduler({
      cron,
      getConfig: () => makeConfig(['a']),
      runPipeline: async () => {
        throw new Error('downstream');
      },
      logger,
    });
    scheduler.start();

    await expect(scheduler.trigger('a')).resolves.toBeUndefined();
    expect(logger.logs.some((l) => /downstream/.test(l))).toBe(true);
  });
});
