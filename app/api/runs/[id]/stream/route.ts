import { db } from "@/lib/db";
import { getRunWithSteps } from "@/lib/repos/runs";
import { subscribe, type RunEvent } from "@/lib/engine/bus";

export const dynamic = "force-dynamic";

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

      // Replay whatever is already persisted so a late subscriber catches up.
      const run = getRunWithSteps(db(), runId);
      for (const s of run.steps) {
        send({
          type: "step",
          position: s.position,
          agent_name: s.agent_name,
          step_id: s.id,
        });
        if (s.output) {
          send({ type: "chunk", position: s.position, text: s.output });
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
        send({ type: "done", status: run.status });
        close();
        return;
      }

      const unsub = subscribe(runId, (event) => {
        send(event);
        if (event.type === "done") {
          unsub();
          close();
        }
      });

      req.signal?.addEventListener("abort", () => {
        unsub();
        close();
      });
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
