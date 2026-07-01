export interface RunStepOptions {
  argv: string[];
  input: string;
  timeoutMs: number;
  onChunk?: (text: string) => void;
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

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL"); // force-kill a hung process
  }, opts.timeoutMs);

  // Drain stdout and stderr concurrently — reading one fully before the other
  // can deadlock a child that fills the unread pipe's buffer.
  const [stdout, stderr] = await Promise.all([
    readStream(proc.stdout, opts.onChunk),
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
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      out += text;
      if (onChunk && text) onChunk(text);
    }
  } finally {
    reader.releaseLock();
  }
  return out;
}
