import { db } from "@/lib/db";
import { getRunWithSteps } from "@/lib/repos/runs";
import { subscribe, type RunEvent } from "@/lib/engine/bus";
import type { TranscriptEntry } from "@/lib/engine/transcript";

export const dynamic = "force-dynamic";

function parseTranscript(json: string): TranscriptEntry[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as TranscriptEntry[]) : [];
  } catch {
    return [];
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const runId = Number(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (obj: RunEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Subscribe FIRST (buffering) so no event published during replay is
      // lost. Chunk events carry the full cumulative snapshot, and the client
      // handlers are idempotent, so replay + buffered live events can't
      // double-count. Flush the buffer once replay is done.
      let replayed = false;
      const buffered: RunEvent[] = [];
      const deliver = (event: RunEvent) => {
        send(event);
        if (event.type === "done") {
          unsub();
          close();
        }
      };
      const unsub = subscribe(runId, (event) => {
        if (replayed) deliver(event);
        else buffered.push(event);
      });

      req.signal?.addEventListener("abort", () => {
        unsub();
        close();
      });

      // Replay whatever is already persisted so a late subscriber catches up.
      // The transcript is a full snapshot and the client handlers are
      // idempotent, so replay + buffered live events can't double-count.
      const run = getRunWithSteps(db(), runId);
      for (const s of run.steps) {
        send({
          type: "step",
          position: s.position,
          agent_name: s.agent_name,
          step_id: s.id,
        });
        const entries = parseTranscript(s.transcript);
        if (entries.length > 0) {
          send({ type: "transcript", position: s.position, entries });
        }
        if (s.status !== "running") {
          send({
            type: "step_done",
            position: s.position,
            status: s.status,
            exit_code: s.exit_code,
          });
        }
      }

      if (run.status !== "running") {
        unsub();
        send({ type: "done", status: run.status });
        close();
        return;
      }

      replayed = true;
      for (const event of buffered) deliver(event);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
