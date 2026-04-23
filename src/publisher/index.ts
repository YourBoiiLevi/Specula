import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execa } from 'execa';
import type { SpeculaConfig, Report } from '../types.js';
import { generate as defaultGenerate, type GenerateResult } from '../ssg/index.js';

export interface PublishContext {
  /** The report that triggered this publish (for commit message). If omitted, uses a generic message. */
  report?: Report;
  /** Override current time for deterministic tests */
  now?: Date;
}

export interface PublishResult {
  ok: boolean;
  ssg: GenerateResult | null;
  /** Absolute path to siteRepoPath */
  siteRepoPath: string;
  /** Whether the working tree had any changes (`git status --porcelain` non-empty) */
  hadChanges: boolean;
  /** Commit SHA after push (empty string if no commit) */
  commitSha: string;
  /** Stdout/stderr tails collected for logging, last 4KB */
  log: string;
  /** Populated only if ok=false */
  error?: string;
}

export type PublisherRun = (
  file: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface PublisherDeps {
  /** Override the SSG generate function (for tests). */
  generate?: typeof import('../ssg/index.js').generate;
  /** Override execa-like runner. Contract: runs a command and returns {stdout, stderr, exitCode}. */
  run?: PublisherRun;
  /** Override the site build dir (default: "./site-build"). For tests. */
  buildDir?: string;
}

const LOG_TAIL_BYTES = 4096;

async function defaultRun(
  file: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execa(file, args, {
      cwd: opts.cwd,
      ...(opts.env ? { env: opts.env } : {}),
      reject: false,
      stripFinalNewline: false,
    });
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: msg, exitCode: 1 };
  }
}

function appendLog(chunks: string[], cmd: string, stdout: string, stderr: string): void {
  chunks.push(`\n$ ${cmd}\n${stdout}${stderr ? '\n' + stderr : ''}`);
}

function tailLog(chunks: string[]): string {
  const full = chunks.join('');
  if (full.length <= LOG_TAIL_BYTES) return full;
  const cut = full.length - LOG_TAIL_BYTES;
  const kept = full.slice(cut);
  return `[... ${cut} chars truncated]\n${kept}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatReportCommitMessage(report: Report): string {
  const date = new Date(report.generatedAt);
  const stamp =
    `${date.getUTCFullYear().toString().padStart(4, '0')}-` +
    `${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  return `report: ${report.pipelineLabel} @ ${stamp} UTC`;
}

function formatCommitMessage(ctx: PublishContext | undefined): string {
  if (ctx?.report) {
    return formatReportCommitMessage(ctx.report);
  }
  const isoNow = (ctx?.now ?? new Date()).toISOString();
  return `site: manual publish @ ${isoNow}`;
}

async function wipeDestination(siteRepoPath: string): Promise<void> {
  const entries = await fs.readdir(siteRepoPath);
  for (const entry of entries) {
    if (entry === '.git') continue;
    await fs.rm(path.join(siteRepoPath, entry), { recursive: true, force: true });
  }
}

/**
 * Generate the site, sync it into config.siteRepoPath, and git add/commit/push.
 * Never throws — returns { ok: false, error } on failure.
 */
export async function publish(
  config: SpeculaConfig,
  ctx?: PublishContext,
  deps?: PublisherDeps,
): Promise<PublishResult> {
  const siteRepoPath = path.resolve(config.siteRepoPath);
  const buildDir = deps?.buildDir ?? path.resolve('./site-build');
  const run: PublisherRun = deps?.run ?? defaultRun;
  const generate = deps?.generate ?? defaultGenerate;
  const logChunks: string[] = [];

  // 1. Build the site into a staging dir.
  console.log(`[publisher] generating site → ${buildDir}`);
  let ssg: GenerateResult;
  try {
    ssg = await generate(config, { outDir: buildDir });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const error = `SSG failed: ${msg}`;
    console.error(`[publisher] ${error}`);
    return {
      ok: false,
      ssg: null,
      siteRepoPath,
      hadChanges: false,
      commitSha: '',
      log: '',
      error,
    };
  }

  // 2. Verify siteRepoPath exists and is a git repo.
  if (!existsSync(siteRepoPath) || !existsSync(path.join(siteRepoPath, '.git'))) {
    const error = `siteRepoPath is not an initialized git repository: ${siteRepoPath}`;
    console.error(`[publisher] ${error}`);
    return {
      ok: false,
      ssg,
      siteRepoPath,
      hadChanges: false,
      commitSha: '',
      log: '',
      error,
    };
  }

  // 3. Sync built site into siteRepoPath (preserving .git/).
  console.log(`[publisher] syncing to ${siteRepoPath}`);
  try {
    await wipeDestination(siteRepoPath);
    await fs.cp(buildDir, siteRepoPath, {
      recursive: true,
      force: true,
      filter: (src) => !src.includes('/.git') && !src.includes('\\.git'),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const error = `sync failed: ${msg}`;
    console.error(`[publisher] ${error}`);
    return {
      ok: false,
      ssg,
      siteRepoPath,
      hadChanges: false,
      commitSha: '',
      log: tailLog(logChunks),
      error,
    };
  }

  // 4. Run git commands.
  const runGit = async (
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number; cmd: string }> => {
    const cmd = `git ${args.join(' ')}`;
    const result = await run('git', args, { cwd: siteRepoPath });
    appendLog(logChunks, cmd, result.stdout, result.stderr);
    console.log(`[publisher] ${cmd} → exit ${result.exitCode}`);
    return { ...result, cmd };
  };

  // git add -A
  const addRes = await runGit(['add', '-A']);
  if (addRes.exitCode !== 0) {
    const error = `git add failed: ${addRes.stderr.trim()}`;
    console.error(`[publisher] ${error}`);
    return {
      ok: false,
      ssg,
      siteRepoPath,
      hadChanges: true,
      commitSha: '',
      log: tailLog(logChunks),
      error,
    };
  }

  // git status --porcelain
  const statusRes = await runGit(['status', '--porcelain']);
  if (statusRes.exitCode !== 0) {
    const error = `git status failed: ${statusRes.stderr.trim()}`;
    console.error(`[publisher] ${error}`);
    return {
      ok: false,
      ssg,
      siteRepoPath,
      hadChanges: true,
      commitSha: '',
      log: tailLog(logChunks),
      error,
    };
  }

  if (statusRes.stdout.trim() === '') {
    console.log('[publisher] no changes to publish');
    return {
      ok: true,
      ssg,
      siteRepoPath,
      hadChanges: false,
      commitSha: '',
      log: tailLog(logChunks),
    };
  }

  // git commit
  const commitMsg = formatCommitMessage(ctx);
  const commitArgs = [
    '-c',
    'user.name=Specula',
    '-c',
    'user.email=specula@localhost',
    'commit',
    '-m',
    commitMsg,
  ];
  const commitRes = await runGit(commitArgs);
  if (commitRes.exitCode !== 0) {
    const error = `git commit failed: ${commitRes.stderr.trim()}`;
    console.error(`[publisher] ${error}`);
    return {
      ok: false,
      ssg,
      siteRepoPath,
      hadChanges: true,
      commitSha: '',
      log: tailLog(logChunks),
      error,
    };
  }

  // git rev-parse HEAD
  const revRes = await runGit(['rev-parse', 'HEAD']);
  if (revRes.exitCode !== 0) {
    const error = `git rev-parse failed: ${revRes.stderr.trim()}`;
    console.error(`[publisher] ${error}`);
    return {
      ok: false,
      ssg,
      siteRepoPath,
      hadChanges: true,
      commitSha: '',
      log: tailLog(logChunks),
      error,
    };
  }
  const commitSha = revRes.stdout.trim();

  // git push origin HEAD
  const pushRes = await runGit(['push', 'origin', 'HEAD']);
  if (pushRes.exitCode !== 0) {
    const error = `git push failed: ${pushRes.stderr.trim()}`;
    console.error(`[publisher] ${error}`);
    return {
      ok: false,
      ssg,
      siteRepoPath,
      hadChanges: true,
      commitSha: '',
      log: tailLog(logChunks),
      error,
    };
  }

  console.log(`[publisher] pushed ${commitSha.slice(0, 7)}`);
  return {
    ok: true,
    ssg,
    siteRepoPath,
    hadChanges: true,
    commitSha,
    log: tailLog(logChunks),
  };
}
