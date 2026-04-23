import { describe, it, expect, beforeEach } from 'vitest';
import { setStatus, mergeStatus, getStatus, listStatus, clearStatus } from './index.js';

describe('status store', () => {
  beforeEach(() => {
    clearStatus();
  });

  it('setStatus round-trip', () => {
    setStatus({ pipelineId: 'p1', lastRunStatus: 'running' });
    expect(getStatus('p1')).toEqual({ pipelineId: 'p1', lastRunStatus: 'running' });
  });

  it('mergeStatus preserves unset fields', () => {
    setStatus({ pipelineId: 'p1', lastRunStatus: 'success', lastItemCount: 5 });
    mergeStatus('p1', { lastRunStatus: 'idle' });
    expect(getStatus('p1')).toEqual({ pipelineId: 'p1', lastRunStatus: 'idle', lastItemCount: 5 });
  });

  it('listStatus orders by supplied ids and synthesises idle defaults', () => {
    setStatus({ pipelineId: 'p2', lastRunStatus: 'success' });
    const list = listStatus(['p1', 'p2']);
    expect(list).toEqual([
      { pipelineId: 'p1', lastRunStatus: 'idle' },
      { pipelineId: 'p2', lastRunStatus: 'success' },
    ]);
  });

  it('listStatus with no args returns everything', () => {
    setStatus({ pipelineId: 'p1', lastRunStatus: 'success' });
    setStatus({ pipelineId: 'p2', lastRunStatus: 'error' });
    const list = listStatus();
    expect(list).toEqual([
      { pipelineId: 'p1', lastRunStatus: 'success' },
      { pipelineId: 'p2', lastRunStatus: 'error' },
    ]);
  });

  it('clearStatus empties the map', () => {
    setStatus({ pipelineId: 'p1', lastRunStatus: 'success' });
    clearStatus();
    expect(listStatus()).toEqual([]);
  });
});
