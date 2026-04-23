import { Bash } from 'just-bash';
import { tool, type Tool } from 'ai';
import { z } from 'zod';

export interface CreateBashToolOptions {
  /** Files to seed the in-memory FS with (absolute paths -> contents) */
  files: Record<string, string>;
  /** Working directory inside the VFS. Default: "/" */
  cwd?: string;
  /** Max stdout/stderr chars returned to the model per call. Default: 16_000 */
  maxOutputChars?: number;
  /** Per-exec timeout ms. Default: 15_000 */
  execTimeoutMs?: number;
}

export interface CreateBashToolResult {
  /** The AI SDK tool object to pass as `tools: { bash: tool }` */
  tool: Tool;
  /** The underlying Bash instance (exposed for tests) */
  bash: Bash;
}

const DEFAULT_MAX_OUTPUT_CHARS = 16_000;
const DEFAULT_EXEC_TIMEOUT_MS = 15_000;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const kept = text.slice(0, limit);
  const truncated = text.length - limit;
  return `${kept}\n\n[... truncated ${truncated} chars]`;
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 0) {
    return new AbortController().signal;
  }
  if (signals.length === 1) {
    return signals[0] as AbortSignal;
  }
  return AbortSignal.any(signals);
}

export function createBashTool(options: CreateBashToolOptions): CreateBashToolResult {
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const execTimeoutMs = options.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const cwd = options.cwd ?? '/';

  const bash = new Bash({
    files: options.files,
    cwd,
  });

  const bashTool = tool({
    description:
      'Execute a bash command in an in-memory sandbox with the feed items mounted under /feeds. Supports cat, grep, ls, head, tail, wc, jq, awk, sed, find, and pipelines. No network or real filesystem access.',
    inputSchema: z.object({
      cmd: z
        .string()
        .describe(
          'Bash command to execute. Example: "cat /index.md" or "grep -l \'openai\' /feeds/*.md".',
        ),
    }),
    execute: async ({ cmd }, { abortSignal }) => {
      const timeoutController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        timeoutController.abort(new Error(`bash tool exec timeout after ${execTimeoutMs}ms`));
      }, execTimeoutMs);

      const signals: AbortSignal[] = [timeoutController.signal];
      if (abortSignal) signals.push(abortSignal);
      const combined = combineSignals(signals);

      try {
        const result = await bash.exec(cmd, { signal: combined });
        if (timeoutController.signal.aborted) {
          return `$ ${cmd}\n[error] command timed out after ${execTimeoutMs}ms\nexit: 1`;
        }

        const stdout = truncate(result.stdout, maxOutputChars);
        const stderr = truncate(result.stderr, maxOutputChars);

        if (result.exitCode === 0 && result.stderr === '') {
          return `$ ${cmd}\n${stdout}`;
        }
        return `$ ${cmd}\n${stdout}\n---\nexit: ${result.exitCode}\nstderr: ${stderr}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `$ ${cmd}\n[error] ${message}\nexit: 1`;
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
  });

  return { tool: bashTool, bash };
}
