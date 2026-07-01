import { expect, test } from "bun:test";
import { buildArgv } from "../../lib/engine/template";

const ctx = {
  system: "be nice",
  input: "do X",
  projects: ["/a b", "/c"],
  model: "opus",
  effort: "high",
};

test("{system} becomes a single argv token", () => {
  expect(
    buildArgv("claude -p --append-system-prompt {system}", ctx),
  ).toEqual(["claude", "-p", "--append-system-prompt", "be nice"]);
});

test("{projects} expands to one token per path", () => {
  expect(buildArgv("tool {projects}", ctx)).toEqual(["tool", "/a b", "/c"]);
});

test("{projects:--flag} expands to flag+path pairs", () => {
  expect(buildArgv("tool {projects:--add-dir}", ctx)).toEqual([
    "tool",
    "--add-dir",
    "/a b",
    "--add-dir",
    "/c",
  ]);
});

test("{input} becomes a single token", () => {
  expect(buildArgv("tool {input}", ctx)).toEqual(["tool", "do X"]);
});

test("quoted literals are one token", () => {
  expect(buildArgv("tool 'a b' c", ctx)).toEqual(["tool", "a b", "c"]);
});

test("placeholder embedded in a larger token is substituted in place", () => {
  expect(buildArgv("tool x={system}", ctx)).toEqual(["tool", "x=be nice"]);
});

test("empty projects list yields nothing for the placeholder", () => {
  expect(buildArgv("tool {projects:--add-dir} end", { ...ctx, projects: [] }))
    .toEqual(["tool", "end"]);
});

test("{model:--flag} emits flag + value", () => {
  expect(buildArgv("c {model:--model}", ctx)).toEqual(["c", "--model", "opus"]);
});

test("{effort:--flag} emits flag + value when set", () => {
  expect(buildArgv("c {effort:--effort}", ctx)).toEqual([
    "c",
    "--effort",
    "high",
  ]);
});

test("{effort:--flag} emits nothing when effort is empty", () => {
  expect(buildArgv("c {effort:--effort} d", { ...ctx, effort: "" })).toEqual([
    "c",
    "d",
  ]);
});

test("bare {model} substitutes in place", () => {
  expect(buildArgv("m={model}", ctx)).toEqual(["m=opus"]);
});

test("full claude template", () => {
  expect(
    buildArgv(
      "claude -p {model:--model} {effort:--effort} --append-system-prompt {system} {projects:--add-dir}",
      ctx,
    ),
  ).toEqual([
    "claude",
    "-p",
    "--model",
    "opus",
    "--effort",
    "high",
    "--append-system-prompt",
    "be nice",
    "--add-dir",
    "/a b",
    "--add-dir",
    "/c",
  ]);
});
