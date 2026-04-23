import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FeedItem, Report, SeenState } from '../types.js';

export function getDataDir(): string {
  const override = process.env['SPECULA_DATA_DIR'];
  if (override && override.length > 0) return override;
  return './data';
}

export function reportDir(pipelineId: string): string {
  return path.join(getDataDir(), 'reports', pipelineId);
}

export function seenPath(pipelineId: string): string {
  return path.join(getDataDir(), 'seen', `${pipelineId}.json`);
}

function stripPipelinePrefix(report: Report): string {
  const prefix = `${report.pipelineId}-`;
  if (!report.id.startsWith(prefix)) {
    throw new Error(
      `Report id "${report.id}" does not start with expected prefix "${prefix}".`,
    );
  }
  return report.id.slice(prefix.length);
}

export async function saveReport(report: Report): Promise<string> {
  const dir = path.resolve(reportDir(report.pipelineId));
  await fs.mkdir(dir, { recursive: true });
  const timestamp = stripPipelinePrefix(report);
  const file = path.join(dir, `${timestamp}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return null;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[store] Failed to read ${filePath}: ${msg}`);
    return null;
  }
}

function reviveReport(raw: unknown, sourcePath: string): Report | null {
  if (typeof raw !== 'object' || raw === null) {
    console.warn(`[store] Invalid report structure in ${sourcePath}`);
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate['id'] !== 'string' ||
    typeof candidate['pipelineId'] !== 'string' ||
    typeof candidate['generatedAt'] !== 'string'
  ) {
    console.warn(`[store] Report missing required fields in ${sourcePath}`);
    return null;
  }
  return candidate as unknown as Report;
}

async function readReportsFromDir(dir: string): Promise<Report[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return [];
    throw err;
  }
  const files = entries.filter((e) => e.endsWith('.json'));
  const reports: Report[] = [];
  for (const name of files) {
    const full = path.join(dir, name);
    const parsed = await readJsonFile<unknown>(full);
    if (parsed === null) continue;
    const report = reviveReport(parsed, full);
    if (report) reports.push(report);
  }
  return reports;
}

export async function listReports(opts?: {
  pipelineId?: string;
  limit?: number;
}): Promise<Report[]> {
  const baseReportsDir = path.join(getDataDir(), 'reports');
  let all: Report[] = [];

  if (opts?.pipelineId) {
    all = await readReportsFromDir(reportDir(opts.pipelineId));
  } else {
    let subdirs: string[] = [];
    try {
      const entries = await fs.readdir(baseReportsDir, { withFileTypes: true });
      subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') return [];
      throw err;
    }
    for (const sub of subdirs) {
      const reports = await readReportsFromDir(path.join(baseReportsDir, sub));
      all.push(...reports);
    }
  }

  all.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  if (typeof opts?.limit === 'number') {
    all = all.slice(0, opts.limit);
  }
  return all;
}

export async function getReport(reportId: string): Promise<Report | null> {
  const all = await listReports();
  return all.find((r) => r.id === reportId) ?? null;
}

export async function loadSeen(pipelineId: string): Promise<SeenState> {
  const file = seenPath(pipelineId);
  const parsed = await readJsonFile<unknown>(file);
  if (parsed === null) return { ids: {} };
  if (typeof parsed !== 'object' || parsed === null) {
    console.warn(`[store] Invalid seen state at ${file}; resetting.`);
    return { ids: {} };
  }
  const candidate = parsed as Record<string, unknown>;
  const ids = candidate['ids'];
  if (typeof ids !== 'object' || ids === null || Array.isArray(ids)) {
    console.warn(`[store] Malformed seen.ids at ${file}; resetting.`);
    return { ids: {} };
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(ids as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return { ids: out };
}

export async function saveSeen(
  pipelineId: string,
  state: SeenState,
  windowHours: number,
): Promise<void> {
  const pruned = pruneSeen(state, windowHours);
  const file = seenPath(pipelineId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(pruned, null, 2), 'utf8');
}

export function pruneSeen(state: SeenState, windowHours: number, now?: Date): SeenState {
  const reference = (now ?? new Date()).getTime();
  const cutoff = reference - windowHours * 3600 * 1000;
  const next: Record<string, string> = {};
  for (const [id, iso] of Object.entries(state.ids)) {
    const ts = new Date(iso).getTime();
    if (!Number.isNaN(ts) && ts >= cutoff) {
      next[id] = iso;
    }
  }
  return { ids: next };
}

export function filterUnseen(items: FeedItem[], state: SeenState): FeedItem[] {
  return items.filter((item) => !(item.id in state.ids));
}

export function markSeen(state: SeenState, items: FeedItem[], now?: Date): SeenState {
  const stamp = (now ?? new Date()).toISOString();
  const next: Record<string, string> = { ...state.ids };
  for (const item of items) {
    next[item.id] = stamp;
  }
  return { ids: next };
}
