import type { Pipeline, PipelineRunStatus, SpeculaConfig } from './types.js';
import {
  runPipeline as runnerRunPipeline,
  type PipelineRunnerDeps,
  type RunPipelineResult,
} from './runner/index.js';
import {
  publish as defaultPublish,
  type PublishResult,
  type PublisherDeps,
} from './publisher/index.js';
import { mergeStatus } from './status/index.js';

export interface PipelineRunOptions {
  /** Dependency overrides for the runner (fetch/parse/analyze/etc.). */
  runnerDeps?: PipelineRunnerDeps;
  /** Dependency overrides for the publisher (SSG, git, build dir). */
  publisherDeps?: PublisherDeps;
  /** Override the publisher implementation itself. */
  publish?: typeof defaultPublish;
  /** When false, skip the publish step even on runner success. Default: true. */
  shouldPublish?: boolean;
  /** Override current time (e.g. for tests / deterministic stamps). */
  now?: () => Date;
}

export interface PipelineRunOutcome {
  run: RunPipelineResult;
  publish?: PublishResult;
}

function buildRunnerDeps(opts?: PipelineRunOptions): PipelineRunnerDeps | undefined {
  if (!opts) return undefined;
  if (!opts.runnerDeps && !opts.now) return undefined;
  const deps: PipelineRunnerDeps = { ...(opts.runnerDeps ?? {}) };
  if (opts.now) deps.now = opts.now;
  return deps;
}

function statusPatchFromRun(
  run: RunPipelineResult,
): Partial<Omit<PipelineRunStatus, 'pipelineId'>> {
  const patch: Partial<Omit<PipelineRunStatus, 'pipelineId'>> = {
    lastRunStatus: run.status,
    lastItemCount: run.analyzedItems,
  };
  if (run.modelUsed) patch.lastModelUsed = run.modelUsed;
  if (run.reportId) patch.lastReportId = run.reportId;
  if (run.error) patch.lastError = run.error;
  if (run.status === 'success' && run.report) {
    patch.lastRunAt = run.report.generatedAt;
  }
  return patch;
}

/**
 * Run a single pipeline end-to-end: fetch → parse → dedupe → analyze → store,
 * then (optionally) render the static site and publish it to the configured
 * git repo. Status updates are emitted to the in-memory status store so the
 * Config UI reflects progress in real time.
 *
 * Never throws: runner + publisher errors are captured in the return value and
 * mirrored into status. The scheduler relies on this contract so a failing
 * pipeline can't kill the process.
 */
export async function runPipeline(
  config: SpeculaConfig,
  pipeline: Pipeline,
  opts?: PipelineRunOptions,
): Promise<PipelineRunOutcome> {
  const publish = opts?.publish ?? defaultPublish;
  const nowFactory = opts?.now ?? (() => new Date());
  const startedAt = nowFactory();

  mergeStatus(pipeline.id, {
    lastRunStatus: 'running',
    lastRunAt: startedAt.toISOString(),
  });
  console.log(`[pipeline] ${pipeline.id}: starting`);

  const runnerDeps = buildRunnerDeps(opts);
  const run = runnerDeps
    ? await runnerRunPipeline(config, pipeline, runnerDeps)
    : await runnerRunPipeline(config, pipeline);

  mergeStatus(pipeline.id, statusPatchFromRun(run));
  console.log(
    `[pipeline] ${pipeline.id}: runner finished — status=${run.status} analyzed=${run.analyzedItems}` +
      (run.modelUsed ? ` model=${run.modelUsed}` : '') +
      (run.error ? ` error=${run.error}` : ''),
  );

  const shouldPublish = (opts?.shouldPublish ?? true) && run.status === 'success';
  if (!shouldPublish) {
    return { run };
  }

  const publishResult = run.report
    ? await publish(config, { report: run.report }, opts?.publisherDeps)
    : await publish(config, undefined, opts?.publisherDeps);

  if (!publishResult.ok) {
    console.error(
      `[pipeline] ${pipeline.id}: publisher failed — ${publishResult.error ?? 'unknown error'}`,
    );
    // Record the publish failure as a soft error on status. Runner succeeded,
    // so keep lastRunStatus='success' (the report is safely persisted) but
    // expose the publish error so operators can see the site is stale.
    mergeStatus(pipeline.id, {
      lastError: `publisher: ${publishResult.error ?? 'unknown error'}`,
    });
  } else {
    console.log(
      `[pipeline] ${pipeline.id}: published — commit=${publishResult.commitSha || '(no changes)'}`,
    );
  }

  return { run, publish: publishResult };
}
