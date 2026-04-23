import type { PipelineRunStatus } from '../types.js';

const statuses = new Map<string, PipelineRunStatus>();

export function setStatus(status: PipelineRunStatus): void {
  statuses.set(status.pipelineId, { ...status });
}

export function mergeStatus(
  pipelineId: string,
  partial: Partial<Omit<PipelineRunStatus, 'pipelineId'>>,
): PipelineRunStatus {
  const current = statuses.get(pipelineId) ?? { pipelineId, lastRunStatus: 'idle' as const };
  const next: PipelineRunStatus = { ...current, ...partial, pipelineId };
  statuses.set(pipelineId, next);
  // Return a shallow copy so callers can't mutate the stored entry.
  return { ...next };
}

export function getStatus(pipelineId: string): PipelineRunStatus | undefined {
  const found = statuses.get(pipelineId);
  return found ? { ...found } : undefined;
}

/**
 * Return statuses sorted by `orderedPipelineIds` if provided, with a default
 * `{ pipelineId, lastRunStatus: 'idle' }` synthesised for any id that has no
 * recorded status yet. If `orderedPipelineIds` is omitted, returns all stored
 * statuses in insertion order (Map iteration order).
 */
export function listStatus(orderedPipelineIds?: string[]): PipelineRunStatus[] {
  if (orderedPipelineIds && orderedPipelineIds.length > 0) {
    return orderedPipelineIds.map(
      (id) =>
        getStatus(id) ?? ({ pipelineId: id, lastRunStatus: 'idle' as const } satisfies PipelineRunStatus),
    );
  }
  return Array.from(statuses.values()).map((s) => ({ ...s }));
}

export function clearStatus(): void {
  statuses.clear();
}
