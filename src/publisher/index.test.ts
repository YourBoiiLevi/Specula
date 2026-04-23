import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { publish, type PublisherDeps, type PublisherRun } from './index.js';
import type { SpeculaConfig, Report } from '../types.js';

type RunResult = { stdout: string; stderr: string; exitCode: number };
type RunCall = { file: string; args: string[]; cwd: string };

const OK: RunResult = { stdout: '', stderr: '', exitCode: 0 };

function baseConfig(siteRepoPath: string): SpeculaConfig {
  return {
    intervalHours: 1,
    primaryModel: 'test',
    fallbackModel: 'test',
    thinkingLevel: 'low',
    maxItemsPerRun: 10,
    dedupWindowHours: 24,
    siteRepoPath,
    githubPagesUrl: 'https://example.com',
    feedTitle: 'Test Feed',
    feedDescription: 'Test',
    configUiPort: 3000,
    pipelines: [
      {
        id: 'ai-research',
        label: 'AI Research',
        description: '',
        feedGroups: [{ id: 'g1', label: 'G1', url: 'https://example.com/rss' }],
      },
    ],
  };
}

const sampleReport: Report = {
  id: 'ai-research-2026-04-23-12-00',
  pipelineId: 'ai-research',
  pipelineLabel: 'AI Research',
  generatedAt: '2026-04-23T12:00:00Z',
  itemCount: 1,
  modelUsed: 'test',
  sources: [],
  body: 'body',
  wordCount: 1,
};

function classifyGitArgs(args: readonly string[]): 'add' | 'status' | 'commit' | 'rev-parse' | 'push' | 'other' {
  if (args[0] === 'add') return 'add';
  if (args[0] === 'status') return 'status';
  if (args.includes('commit')) return 'commit';
  if (args[0] === 'rev-parse') return 'rev-parse';
  if (args[0] === 'push') return 'push';
  return 'other';
}

function makeGenerate(
  opts: { write?: boolean; throwError?: string } = {},
): NonNullable<PublisherDeps['generate']> {
  const { write = true, throwError } = opts;
  const stub: NonNullable<PublisherDeps['generate']> = async (_cfg, options) => {
    if (throwError) throw new Error(throwError);
    const outDir = options?.outDir ?? path.resolve('./site-build');
    await fs.mkdir(outDir, { recursive: true });
    if (write) {
      await fs.writeFile(path.join(outDir, 'index.html'), '<html>hi</html>', 'utf-8');
    }
    return { reportCount: 0, pipelineCount: 0, outDir, durationMs: 0 };
  };
  return stub;
}

type StepOverrides = Partial<Record<'add' | 'status' | 'commit' | 'rev-parse' | 'push', RunResult>>;

function makeRun(calls: RunCall[], overrides: StepOverrides = {}): PublisherRun {
  const defaults: Record<'add' | 'status' | 'commit' | 'rev-parse' | 'push', RunResult> = {
    add: OK,
    status: { stdout: 'M index.html\n', stderr: '', exitCode: 0 },
    commit: OK,
    'rev-parse': { stdout: 'abc1234567890\n', stderr: '', exitCode: 0 },
    push: OK,
  };
  return async (file, args, opts) => {
    calls.push({ file, args: [...args], cwd: opts.cwd });
    const kind = classifyGitArgs(args);
    if (kind === 'other') {
      return { stdout: '', stderr: `unexpected ${args.join(' ')}`, exitCode: 99 };
    }
    return overrides[kind] ?? defaults[kind];
  };
}

let tmpBuildDir: string;
let tmpRepoDir: string;

beforeEach(async () => {
  tmpBuildDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specula-pub-build-'));
  tmpRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specula-pub-repo-'));
});

afterEach(async () => {
  await fs.rm(tmpBuildDir, { recursive: true, force: true });
  await fs.rm(tmpRepoDir, { recursive: true, force: true });
});

async function markAsGitRepo(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, '.git'), { recursive: true });
}

describe('publish', () => {
  it('happy path: syncs site, commits with report message, and pushes', async () => {
    await markAsGitRepo(tmpRepoDir);
    const calls: RunCall[] = [];
    const deps: PublisherDeps = {
      generate: makeGenerate(),
      run: makeRun(calls),
      buildDir: tmpBuildDir,
    };
    const config = baseConfig(tmpRepoDir);

    const result = await publish(config, { report: sampleReport }, deps);

    expect(result.ok).toBe(true);
    expect(result.hadChanges).toBe(true);
    expect(result.commitSha).toBe('abc1234567890');
    expect(result.siteRepoPath).toBe(tmpRepoDir);
    expect(result.error).toBeUndefined();
    expect(result.ssg).not.toBeNull();
    expect(result.log).toContain('$ git add -A');

    // Every git call should run inside siteRepoPath.
    for (const c of calls) {
      expect(c.file).toBe('git');
      expect(c.cwd).toBe(tmpRepoDir);
    }

    const steps = calls.map((c) => classifyGitArgs(c.args));
    expect(steps).toEqual(['add', 'status', 'commit', 'rev-parse', 'push']);

    const commitCall = calls.find((c) => classifyGitArgs(c.args) === 'commit');
    expect(commitCall).toBeDefined();
    expect(commitCall!.args).toContain('user.name=Specula');
    expect(commitCall!.args).toContain('user.email=specula@localhost');
    expect(commitCall!.args).toContain('report: AI Research @ 2026-04-23 12:00 UTC');

    // Sync actually copied the built file into the repo dir.
    const copied = await fs.readFile(path.join(tmpRepoDir, 'index.html'), 'utf-8');
    expect(copied).toContain('<html>hi</html>');

    const pushCall = calls.find((c) => classifyGitArgs(c.args) === 'push');
    expect(pushCall?.args).toEqual(['push', 'origin', 'HEAD']);
  });

  it('no-op when working tree is clean (status empty)', async () => {
    await markAsGitRepo(tmpRepoDir);
    const calls: RunCall[] = [];
    const deps: PublisherDeps = {
      generate: makeGenerate(),
      run: makeRun(calls, { status: { stdout: '', stderr: '', exitCode: 0 } }),
      buildDir: tmpBuildDir,
    };

    const result = await publish(baseConfig(tmpRepoDir), { report: sampleReport }, deps);

    expect(result.ok).toBe(true);
    expect(result.hadChanges).toBe(false);
    expect(result.commitSha).toBe('');
    expect(result.error).toBeUndefined();
    // Log should still have the add+status chunks.
    expect(result.log).toContain('$ git add -A');
    expect(result.log).toContain('$ git status --porcelain');

    const steps = calls.map((c) => classifyGitArgs(c.args));
    expect(steps).toEqual(['add', 'status']);
    expect(steps).not.toContain('commit');
    expect(steps).not.toContain('push');
  });

  it('captures SSG failure without throwing and without invoking run', async () => {
    await markAsGitRepo(tmpRepoDir);
    const calls: RunCall[] = [];
    const deps: PublisherDeps = {
      generate: makeGenerate({ throwError: 'fail' }),
      run: makeRun(calls),
      buildDir: tmpBuildDir,
    };

    const result = await publish(baseConfig(tmpRepoDir), { report: sampleReport }, deps);

    expect(result.ok).toBe(false);
    expect(result.ssg).toBeNull();
    expect(result.hadChanges).toBe(false);
    expect(result.commitSha).toBe('');
    expect(result.log).toBe('');
    expect(result.error).toContain('SSG failed: fail');
    expect(calls).toHaveLength(0);
  });

  it('captures git commit failure', async () => {
    await markAsGitRepo(tmpRepoDir);
    const calls: RunCall[] = [];
    const deps: PublisherDeps = {
      generate: makeGenerate(),
      run: makeRun(calls, {
        commit: { stdout: '', stderr: 'nothing to commit', exitCode: 1 },
      }),
      buildDir: tmpBuildDir,
    };

    const result = await publish(baseConfig(tmpRepoDir), { report: sampleReport }, deps);

    expect(result.ok).toBe(false);
    expect(result.hadChanges).toBe(true);
    expect(result.commitSha).toBe('');
    expect(result.error).toContain('git commit failed');
    expect(result.error).toContain('nothing to commit');

    const steps = calls.map((c) => classifyGitArgs(c.args));
    expect(steps).toEqual(['add', 'status', 'commit']);
    expect(steps).not.toContain('push');
  });

  it('captures git push failure with stderr snippet', async () => {
    await markAsGitRepo(tmpRepoDir);
    const calls: RunCall[] = [];
    const deps: PublisherDeps = {
      generate: makeGenerate(),
      run: makeRun(calls, {
        push: { stdout: '', stderr: 'Permission denied (publickey)', exitCode: 128 },
      }),
      buildDir: tmpBuildDir,
    };

    const result = await publish(baseConfig(tmpRepoDir), { report: sampleReport }, deps);

    expect(result.ok).toBe(false);
    expect(result.hadChanges).toBe(true);
    expect(result.commitSha).toBe('');
    expect(result.error).toContain('git push failed');
    expect(result.error).toContain('Permission denied (publickey)');

    const steps = calls.map((c) => classifyGitArgs(c.args));
    expect(steps).toEqual(['add', 'status', 'commit', 'rev-parse', 'push']);
  });

  it('returns a clear error when siteRepoPath is not a git repo (and generate runs at most once)', async () => {
    // No .git marker.
    const calls: RunCall[] = [];
    let generateCount = 0;
    const deps: PublisherDeps = {
      generate: async (cfg, opts) => {
        generateCount += 1;
        return makeGenerate()(cfg, opts);
      },
      run: makeRun(calls),
      buildDir: tmpBuildDir,
    };

    const result = await publish(baseConfig(tmpRepoDir), { report: sampleReport }, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not an initialized git repository');
    expect(result.error).toContain(tmpRepoDir);
    expect(generateCount).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it('wipes stale files before sync while preserving .git/', async () => {
    await markAsGitRepo(tmpRepoDir);
    await fs.writeFile(path.join(tmpRepoDir, 'stale.html'), '<p>stale</p>', 'utf-8');
    await fs.writeFile(path.join(tmpRepoDir, '.git', 'config'), '[core]\n', 'utf-8');

    const calls: RunCall[] = [];
    const deps: PublisherDeps = {
      generate: async (_cfg, opts) => {
        const outDir = opts?.outDir ?? path.resolve('./site-build');
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, 'new.html'), '<p>new</p>', 'utf-8');
        return { reportCount: 0, pipelineCount: 0, outDir, durationMs: 0 };
      },
      run: makeRun(calls),
      buildDir: tmpBuildDir,
    };

    const result = await publish(baseConfig(tmpRepoDir), { report: sampleReport }, deps);

    expect(result.ok).toBe(true);

    await expect(fs.readFile(path.join(tmpRepoDir, 'new.html'), 'utf-8')).resolves.toContain('<p>new</p>');
    await expect(fs.access(path.join(tmpRepoDir, 'stale.html'))).rejects.toThrow();
    await expect(fs.readFile(path.join(tmpRepoDir, '.git', 'config'), 'utf-8')).resolves.toContain('[core]');
  });

  it('uses generic "site: manual publish @ ..." commit message when no report is provided', async () => {
    await markAsGitRepo(tmpRepoDir);
    const calls: RunCall[] = [];
    const deps: PublisherDeps = {
      generate: makeGenerate(),
      run: makeRun(calls),
      buildDir: tmpBuildDir,
    };

    const now = new Date('2026-04-23T15:30:00Z');
    const result = await publish(baseConfig(tmpRepoDir), { now }, deps);

    expect(result.ok).toBe(true);
    const commitCall = calls.find((c) => classifyGitArgs(c.args) === 'commit');
    expect(commitCall).toBeDefined();
    // Message is the final `-m` argument.
    const msg = commitCall!.args[commitCall!.args.length - 1];
    expect(msg).toBe(`site: manual publish @ ${now.toISOString()}`);
    expect(msg!.startsWith('site: manual publish @')).toBe(true);
  });
});

// Optional real-git end-to-end. Gated so CI doesn't need to run it.
const describeRealGit = process.env['RUN_PUBLISHER_REAL_GIT'] ? describe : describe.skip;

describeRealGit('publish (real git, end-to-end)', () => {
  let bareDir: string;
  let workDir: string;
  let buildDir: string;

  beforeEach(async () => {
    bareDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specula-bare-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specula-work-'));
    buildDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specula-realbuild-'));
    const { execa } = await import('execa');
    await execa('git', ['init', '--bare', '-b', 'main', bareDir]);
    await execa('git', ['init', '-b', 'main', workDir]);
    await execa('git', ['-C', workDir, 'remote', 'add', 'origin', bareDir]);
  });

  afterEach(async () => {
    await fs.rm(bareDir, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(buildDir, { recursive: true, force: true });
  });

  it('commits and pushes to a bare remote', async () => {
    const deps: PublisherDeps = {
      generate: makeGenerate(),
      buildDir,
    };
    const result = await publish(baseConfig(workDir), { report: sampleReport }, deps);

    expect(result.ok).toBe(true);
    expect(result.hadChanges).toBe(true);
    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

    const { execa } = await import('execa');
    const { stdout } = await execa('git', ['-C', bareDir, 'log', '--oneline', '-n', '1']);
    expect(stdout).toContain('report: AI Research @ 2026-04-23 12:00 UTC');
  });
});
