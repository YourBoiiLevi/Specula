import nodeCron, { type ScheduledTask } from 'node-cron';
import { watch, type FSWatcher } from 'node:fs';
import type { Pipeline, SpeculaConfig } from './types.js';
import { calculateOffsets } from '../config.js';

const FACTORS_OF_60 = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60] as const;

export interface SchedulerLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface CronLike {
  schedule(
    expression: string,
    fn: () => void | Promise<void>,
    options?: { name?: string; timezone?: string },
  ): ScheduledTask;
}

export interface SchedulerOptions {
  /** Called whenever a scheduled or manual run fires. Must resolve when done. */
  runPipeline(config: SpeculaConfig, pipeline: Pipeline): Promise<unknown>;
  /** Returns the current config. Called every time the scheduler needs fresh state. */
  getConfig(): SpeculaConfig;
  /** Absolute path to config.json to fs.watch for hot-reload. Omit to disable. */
  configPath?: string;
  /** Override the cron library (for tests). Defaults to `node-cron`. */
  cron?: CronLike;
  /** Override fs.watch (for tests). Defaults to `node:fs` watch. */
  watch?: typeof watch;
  /** Override logger (defaults to console). */
  logger?: SchedulerLogger;
}

export interface ScheduleEntry {
  pipelineId: string;
  offsetMinutes: number;
  cronExpression: string;
}

export interface Scheduler {
  /** Register cron jobs for every pipeline and optionally start fs.watch. */
  start(): void;
  /** Stop all cron jobs and any fs.watch. Safe to call multiple times. */
  stop(): void;
  /** Re-read config and re-register cron jobs. */
  reload(): void;
  /** Manually trigger a pipeline. Respects the per-pipeline mutex. */
  trigger(pipelineId: string): Promise<void>;
  /** Currently scheduled entries (for debug / UI). */
  getSchedule(): ScheduleEntry[];
  /** Pipeline IDs currently running. */
  getActiveRuns(): string[];
}

/**
 * Enforce the blueprint's invariant that pipeline count is a factor of 60.
 * Throws a clear error at startup so cron never registers a bad schedule.
 */
export function validatePipelineCount(n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Pipeline count must be a positive integer. Got ${n}.`);
  }
  if (!(FACTORS_OF_60 as readonly number[]).includes(n)) {
    throw new Error(
      `Pipeline count must be a factor of 60. Got ${n}. Valid: ${FACTORS_OF_60.join(', ')}.`,
    );
  }
}

/**
 * Pure helper: produce the schedule entries the scheduler would register for a
 * given pipeline list. Exposed for tests and the Config UI.
 */
export function buildSchedule(pipelines: Pipeline[]): ScheduleEntry[] {
  validatePipelineCount(pipelines.length);
  const offsets = calculateOffsets(pipelines.length);
  return pipelines.map((pipeline, i) => ({
    pipelineId: pipeline.id,
    offsetMinutes: offsets[i]!,
    cronExpression: `${offsets[i]} * * * *`,
  }));
}

const DEFAULT_LOGGER: SchedulerLogger = {
  info: (m) => console.log(`[scheduler] ${m}`),
  warn: (m) => console.warn(`[scheduler] ${m}`),
  error: (m) => console.error(`[scheduler] ${m}`),
};

const DEFAULT_CRON: CronLike = {
  schedule(expression, fn, options) {
    return nodeCron.schedule(expression, fn, options ?? {});
  },
};

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const logger = opts.logger ?? DEFAULT_LOGGER;
  const cron = opts.cron ?? DEFAULT_CRON;
  const watchImpl = opts.watch ?? watch;

  const tasks = new Map<string, ScheduledTask>();
  const active = new Set<string>();
  let schedule: ScheduleEntry[] = [];
  let watcher: FSWatcher | null = null;
  let reloadTimer: NodeJS.Timeout | null = null;
  let started = false;

  async function runOne(pipelineId: string, reason: 'scheduled' | 'manual'): Promise<void> {
    if (active.has(pipelineId)) {
      logger.warn(`${pipelineId}: ${reason} run skipped — already running`);
      return;
    }
    const cfg = opts.getConfig();
    const pipeline = cfg.pipelines.find((p) => p.id === pipelineId);
    if (!pipeline) {
      logger.warn(`${pipelineId}: ${reason} run skipped — no longer configured`);
      return;
    }
    active.add(pipelineId);
    logger.info(`${pipelineId}: ${reason} run starting`);
    try {
      await opts.runPipeline(cfg, pipeline);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`${pipelineId}: run threw — ${msg}`);
    } finally {
      active.delete(pipelineId);
      logger.info(`${pipelineId}: ${reason} run finished`);
    }
  }

  function register(): void {
    const cfg = opts.getConfig();
    const entries = buildSchedule(cfg.pipelines);
    for (const entry of entries) {
      const task = cron.schedule(
        entry.cronExpression,
        () => {
          void runOne(entry.pipelineId, 'scheduled');
        },
        { name: `specula:${entry.pipelineId}` },
      );
      tasks.set(entry.pipelineId, task);
    }
    schedule = entries;
    logger.info(
      `registered ${entries.length} pipelines: ${entries
        .map((e) => `${e.pipelineId}@:${String(e.offsetMinutes).padStart(2, '0')}`)
        .join(', ')}`,
    );
  }

  function unregister(): void {
    for (const [, task] of tasks) {
      try {
        void task.stop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`failed to stop cron task: ${msg}`);
      }
    }
    tasks.clear();
    schedule = [];
  }

  function clearReloadTimer(): void {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  }

  return {
    start(): void {
      if (started) {
        logger.warn('start() called on already-started scheduler — ignoring');
        return;
      }
      register();
      started = true;

      if (opts.configPath) {
        try {
          watcher = watchImpl(opts.configPath, { persistent: false }, (eventType) => {
            // Debounce rapid-fire events from atomic rename-based writes
            // (Config UI writes tmp + rename; node can emit both 'rename' and 'change').
            clearReloadTimer();
            reloadTimer = setTimeout(() => {
              reloadTimer = null;
              logger.info(`config change (${eventType}) — reloading`);
              try {
                unregister();
                register();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`reload failed: ${msg}`);
              }
            }, 200);
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`fs.watch on ${opts.configPath} failed: ${msg}`);
        }
      }
    },
    stop(): void {
      clearReloadTimer();
      if (watcher) {
        try {
          watcher.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`fs.watch close failed: ${msg}`);
        }
        watcher = null;
      }
      unregister();
      started = false;
    },
    reload(): void {
      clearReloadTimer();
      try {
        unregister();
        register();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`reload failed: ${msg}`);
        throw err;
      }
    },
    async trigger(pipelineId: string): Promise<void> {
      await runOne(pipelineId, 'manual');
    },
    getSchedule(): ScheduleEntry[] {
      return schedule.map((e) => ({ ...e }));
    },
    getActiveRuns(): string[] {
      return [...active];
    },
  };
}
