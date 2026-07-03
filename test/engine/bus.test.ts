import { expect, test } from "bun:test";
import {
  subscribeTasks,
  publishTasksChanged,
  publish,
  subscribe,
} from "../../lib/engine/bus";

test("a throwing task subscriber can't break the publisher or other subscribers", () => {
  let good = 0;
  const unsubBad = subscribeTasks(() => {
    throw new Error("stale stream: controller already closed");
  });
  const unsubGood = subscribeTasks(() => {
    good++;
  });
  try {
    // The runner calls this from setTaskStatus — it must never throw, even if a
    // stale SSE subscriber blows up, and healthy subscribers must still fire.
    expect(() => publishTasksChanged()).not.toThrow();
    expect(good).toBe(1);
  } finally {
    unsubBad();
    unsubGood();
  }
});

test("a throwing run subscriber can't break publish or other subscribers", () => {
  let got = "";
  const unsubBad = subscribe(99, () => {
    throw new Error("boom");
  });
  const unsubGood = subscribe(99, (e) => {
    got = e.type;
  });
  try {
    expect(() => publish(99, { type: "done", status: "succeeded" })).not.toThrow();
    expect(got).toBe("done");
  } finally {
    unsubBad();
    unsubGood();
  }
});
