import { expect, test } from "bun:test";
import { appendFiles } from "../../app/attachments-ui";

const f = (name: string) => new File(["x"], name, { type: "image/png" });

test("distinct names pass through unchanged", () => {
  const out = appendFiles([f("a.png")], [f("b.png")]);
  expect(out.map((x) => x.name)).toEqual(["a.png", "b.png"]);
});

test("a name colliding with the buffer gets -2", () => {
  const out = appendFiles([f("shot.png")], [f("shot.png")]);
  expect(out.map((x) => x.name)).toEqual(["shot.png", "shot-2.png"]);
});

test("same-named files within one batch increment", () => {
  const out = appendFiles([], [f("pasted.png"), f("pasted.png"), f("pasted.png")]);
  expect(out.map((x) => x.name)).toEqual([
    "pasted.png",
    "pasted-2.png",
    "pasted-3.png",
  ]);
});

test("a dotless name still de-duplicates", () => {
  const out = appendFiles([f("LICENSE")], [f("LICENSE")]);
  expect(out.map((x) => x.name)).toEqual(["LICENSE", "LICENSE-2"]);
});
