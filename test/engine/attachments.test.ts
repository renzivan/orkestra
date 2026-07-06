import { expect, test } from "bun:test";
import { withAttachments } from "../../lib/engine/attachments";

test("no paths leaves the text unchanged and exposes no dirs", () => {
  const r = withAttachments("do the thing", []);
  expect(r.input).toBe("do the thing");
  expect(r.dirs).toEqual([]);
});

test("one path appends a delimited block and exposes its parent dir", () => {
  const r = withAttachments("look at this", [
    "/home/u/.orkestra/attachments/42/shot.png",
  ]);
  expect(r.input).toBe(
    "look at this\n\n---\nAttached files (read as needed):\n- /home/u/.orkestra/attachments/42/shot.png",
  );
  expect(r.dirs).toEqual(["/home/u/.orkestra/attachments/42"]);
});

test("multiple paths sharing a dir de-duplicate the exposed dir", () => {
  const r = withAttachments("x", [
    "/a/42/one.png",
    "/a/42/two.log",
    "/a/42/three.txt",
  ]);
  expect(r.input).toContain("- /a/42/one.png");
  expect(r.input).toContain("- /a/42/two.log");
  expect(r.input).toContain("- /a/42/three.txt");
  expect(r.dirs).toEqual(["/a/42"]);
});

test("empty text yields a bare block with no leading separator", () => {
  const r = withAttachments("   ", ["/a/42/one.png"]);
  expect(r.input).toBe(
    "Attached files (read as needed):\n- /a/42/one.png",
  );
});
