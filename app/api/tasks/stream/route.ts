import { subscribeTasks } from "@/lib/engine/bus";

export const dynamic = "force-dynamic";

// A single always-open SSE the tasks board listens to. It carries no payload —
// just a nudge ("something changed") that tells the client to router.refresh().
// The board holds tasks, not run ids, so it can't use the per-run stream; this
// process-wide topic fires whenever any run starts or settles.
//
// Unlike the per-run stream, this one has no natural end — it lives until the
// client navigates away. So we never call controller.close() ourselves (that
// would throw once the platform has already cancelled the stream); we just stop
// producing on cancel/abort. Cleanup is idempotent and guards every enqueue, so
// a late keepalive tick after disconnect can't crash the server.
export function GET(req: Request): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let unsub = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (keepalive) clearInterval(keepalive);
    unsub();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Consumer went away between our closed check and the enqueue.
          cleanup();
        }
      };

      // Flush headers immediately so the client's connection opens now, rather
      // than staying buffered until the first real event (some servers withhold
      // response headers until the first body byte).
      send(`: connected\n\n`);

      unsub = subscribeTasks(() =>
        send(`data: ${JSON.stringify({ type: "changed" })}\n\n`),
      );
      // A comment line keeps proxies from dropping an otherwise-idle connection.
      keepalive = setInterval(() => send(`: keepalive\n\n`), 25000);
      req.signal?.addEventListener("abort", cleanup);
    },
    cancel() {
      // The client disconnected; the platform closes the stream, we just stop.
      cleanup();
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
