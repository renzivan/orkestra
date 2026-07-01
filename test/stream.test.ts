import { expect, test, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync } from "fs";

const DB_FILE = join(tmpdir(), `ork-stream-${process.pid}.db`);

beforeEach(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    const f = DB_FILE + ext;
    if (existsSync(f)) rmSync(f);
  }
  process.env.ORKESTRA_DB = DB_FILE;
  const { resetDb } = await import("../lib/db");
  resetDb();
});

async function collectEvents(body: ReadableStream<Uint8Array>) {
  const events: any[] = [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.replace(/^data: /, "").trim();
      if (line) events.push(JSON.parse(line));
    }
  }
  return events;
}

test("stream replays a finished run and emits a done event", async () => {
  const { db } = await import("../lib/db");
  const Adapters = await import("../lib/repos/adapters");
  const Agents = await import("../lib/repos/agents");
  const Tasks = await import("../lib/repos/tasks");
  const Runs = await import("../lib/repos/runs");
  const { runTask } = await import("../lib/engine/runner");
  const { GET } = await import("../app/api/runs/[id]/stream/route");

  const ad = Adapters.createAdapter(db(), {
    name: "echo",
    command: "bash test/fixtures/echo-model.sh",
  });
  const a = Agents.createAgent(db(), {
    name: "solo",
    base_instruction: "b",
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  const t = Tasks.createTask(db(), {
    title: "T",
    body: "hey",
    target_type: "agent",
    target_id: a.id,
  });
  const run = await runTask(db(), t.id);

  const res = await GET(new Request("http://x/"), {
    params: Promise.resolve({ id: String(run.id) }),
  });
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const events = await collectEvents(res.body!);
  const done = events.find((e) => e.type === "done");
  expect(done?.status).toBe("succeeded");
  expect(events.some((e) => e.type === "chunk")).toBe(true);
});
