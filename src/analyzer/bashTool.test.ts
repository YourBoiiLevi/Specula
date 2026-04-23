import { describe, it, expect } from 'vitest';
import type { Tool } from 'ai';
import { createBashTool } from './bashTool.js';

type ExecuteFn = NonNullable<Tool['execute']>;

interface ExecuteOptions {
  toolCallId: string;
  messages: never[];
  abortSignal: AbortSignal;
  context: undefined;
}

function makeOpts(signal?: AbortSignal): ExecuteOptions {
  return {
    toolCallId: 'test-call',
    messages: [],
    abortSignal: signal ?? new AbortController().signal,
    context: undefined,
  };
}

async function runCmd(tool: Tool, cmd: string, signal?: AbortSignal): Promise<string> {
  const execute = tool.execute as ExecuteFn;
  const result = await execute({ cmd }, makeOpts(signal));
  if (typeof result !== 'string') {
    throw new Error(`Expected string output from bash tool, got ${typeof result}`);
  }
  return result;
}

describe('createBashTool', () => {
  it('cat returns the seeded file content', async () => {
    const { tool } = createBashTool({
      files: { '/feeds/a.md': '# Hello\nThis is a file.' },
    });
    const out = await runCmd(tool, 'cat /feeds/a.md');
    expect(out).toContain('$ cat /feeds/a.md');
    expect(out).toContain('# Hello');
    expect(out).toContain('This is a file.');
    // Success case: no exit/stderr trailer.
    expect(out).not.toContain('exit:');
    expect(out).not.toContain('stderr:');
  });

  it('ls /feeds lists the seeded filenames', async () => {
    const { tool } = createBashTool({
      files: {
        '/feeds/one.md': 'one',
        '/feeds/two.md': 'two',
        '/feeds/three.md': 'three',
      },
    });
    const out = await runCmd(tool, 'ls /feeds');
    expect(out).toContain('one.md');
    expect(out).toContain('two.md');
    expect(out).toContain('three.md');
  });

  it('grep finds patterns across multiple files', async () => {
    const { tool } = createBashTool({
      files: {
        '/feeds/alpha.md': 'This mentions openai in passing.',
        '/feeds/beta.md': 'Nothing relevant here.',
        '/feeds/gamma.md': 'Another openai reference.',
      },
    });
    const out = await runCmd(tool, "grep -l openai /feeds/*.md");
    // Separate the command echo (first line) from grep's matching output.
    const lines = out.split('\n');
    const body = lines.slice(1).join('\n');
    expect(body).toContain('/feeds/alpha.md');
    expect(body).toContain('/feeds/gamma.md');
    expect(body).not.toContain('/feeds/beta.md');
  });

  it('non-zero exit code includes full formatted output with exit and stderr', async () => {
    const { tool } = createBashTool({
      files: { '/hello.md': 'hi' },
    });
    const out = await runCmd(tool, 'cat /does-not-exist');
    expect(out).toMatch(/^\$ cat \/does-not-exist/);
    expect(out).toContain('---');
    expect(out).toContain('exit: 1');
    expect(out).toContain('stderr:');
    expect(out).toContain('No such file or directory');
  });

  it('truncates output beyond maxOutputChars with a trailing marker', async () => {
    const big = 'x'.repeat(500);
    const { tool } = createBashTool({
      files: { '/big.txt': big },
      maxOutputChars: 100,
    });
    const out = await runCmd(tool, 'cat /big.txt');
    expect(out).toContain('[... truncated ');
    expect(out).toMatch(/\[\.\.\. truncated \d+ chars\]/);
    // Output should not contain the full 500-char run (only ~100 x's).
    expect(out.length).toBeLessThan(500);
  });

  it('does not hang when the per-exec timeout fires', async () => {
    const { tool } = createBashTool({
      files: { '/a.md': 'a' },
      execTimeoutMs: 50,
    });
    const start = Date.now();
    const out = await runCmd(tool, 'sleep 5');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(4000);
    expect(out).toMatch(/^\$ sleep 5/);
    // The formatted result must signal an error (timeout or explicit error line).
    expect(out).toMatch(/\[error\]|exit: 1/);
  });
});
