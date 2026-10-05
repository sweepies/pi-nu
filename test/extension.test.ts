import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import nuExtension from "../index.ts";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
type StartHandler = (event: unknown, ctx: {
  cwd: string;
  hasUI: boolean;
  ui: { notify: (message: string, level: string) => void };
}) => Promise<void>;

function harness() {
  const tools: RegisteredTool[] = [];
  const warnings: string[] = [];
  let start: StartHandler | undefined;
  const pi = {
    registerTool(tool: RegisteredTool) { tools.push(tool); },
    on(event: string, handler: StartHandler) {
      assert.equal(event, "session_start");
      start = handler;
    },
  };
  nuExtension(pi as unknown as ExtensionAPI);
  return {
    tools, warnings,
    async start(hasUI = true) {
      assert.ok(start);
      await start({}, {
        cwd: process.cwd(), hasUI,
        ui: { notify(message, level) { assert.equal(level, "warning"); warnings.push(message); } },
      });
    },
  };
}

test("tool starts hidden and becomes available only after a successful probe", async () => {
  const h = harness();
  assert.equal(h.tools.length, 1);
  assert.equal(h.tools[0].exposure, "hidden");
  await h.start();
  assert.equal(h.tools.at(-1)?.exposure, "direct");
  assert.deepEqual(h.warnings, []);
});

test("missing nu warns and leaves the tool hidden", async () => {
  const original = process.env.PATH;
  try {
    process.env.PATH = "/nonexistent/pi-nu-test";
    const h = harness();
    await h.start();
    assert.equal(h.tools.at(-1)?.exposure, "hidden");
    assert.equal(h.warnings.length, 1);
    assert.match(h.warnings[0], /nu tool disabled.*ENOENT/);
  } finally { process.env.PATH = original; }
});

test("headless missing-nu warning goes to stderr, not protocol stdout", async () => {
  const original = process.env.PATH;
  const originalError = console.error;
  const messages: string[] = [];
  try {
    process.env.PATH = "/nonexistent/pi-nu-test";
    console.error = (message: string) => { messages.push(message); };
    const h = harness();
    await h.start(false);
    assert.equal(h.tools.at(-1)?.exposure, "hidden");
    assert.deepEqual(h.warnings, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /nu tool disabled/);
  } finally { process.env.PATH = original; console.error = originalError; }
});
