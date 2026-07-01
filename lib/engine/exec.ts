import { passthrough, type StreamTransform } from "./transcript";

export interface RunStepOptions {
  argv: string[];
  input: string;
  timeoutMs: number;
  onChunk?: (text: string) => void;
  /** Converts raw stdout into clean text (e.g. parse stream-json). Default:
   *  passthrough. Stateful — pass a fresh one per call. */
  transform?: StreamTransform;
  /** Called with the child process right after spawn — lets a caller hold the
   *  handle (e.g. to kill it on a user stop) without reaching into exec. */
  onSpawn?: (proc: Bun.Subprocess) => void;
}

export interface RunStepResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Spawn one CLI: pipe `input` to stdin, stream stdout (calling onChunk),
 * and kill it after `timeoutMs`. Never throws for process-level failures —
 * a non-zero exit or timeout is reported in the result.
 */
export async function runStep(opts: RunStepOptions): Promise<RunStepResult> {
  const proc = Bun.spawn(opts.argv, {
    stdin: new TextEncoder().encode(opts.input),
    stdout: "pipe",
    stderr: "pipe",
  });
  opts.onSpawn?.(proc);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL"); // force-kill a hung process
  }, opts.timeoutMs);

  // Drain stdout and stderr concurrently — reading one fully before the other
  // can deadlock a child that fills the unread pipe's buffer.
  const [stdout, stderr] = await Promise.all([
    readStream(proc.stdout, opts.onChunk, opts.transform ?? passthrough()),
    readStream(proc.stderr),
  ]);
  const rawCode = await proc.exited;
  clearTimeout(timer);

  let exitCode = rawCode ?? -1;
  if (timedOut && exitCode === 0) exitCode = 124;

  return { stdout, stderr, exitCode, timedOut };
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (text: string) => void,
  transform: StreamTransform = passthrough(),
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  const emit = (text: string) => {
    if (!text) return;
    out += text;
    if (onChunk) onChunk(text);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      emit(transform.push(decoder.decode(value, { stream: true })));
    }
    emit(transform.end());
  } finally {
    reader.releaseLock();
  }
  return out;
}
