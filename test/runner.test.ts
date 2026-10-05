import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { formatOutput, runNu } from "../runner.ts";

const cwd = process.cwd();

test("native table output and explicitly requested JSON", async () => {
  const native = await runNu('[{ name: "Ada", score: 95 }]', { cwd });
  assert.equal(native.exitCode, 0);
  assert.match(native.stdout, /Ada/);
  assert.doesNotMatch(native.stdout, /\x1b\[/);
  const json = await runNu('[{ name: "Ada", score: 95 }] | to json --raw', { cwd });
  assert.deepEqual(JSON.parse(json.stdout), [{ name: "Ada", score: 95 }]);
});

test("source quoting and multiline input survive without Bash", async () => {
  const result = await runNu('let text = "hello \'world\' $HOME"\n$text', { cwd });
  assert.equal(result.stdout.trim(), "hello 'world' $HOME");
});

test("execution uses the supplied working directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-nu-test-"));
  try {
    const result = await runNu('$env.PWD', { cwd: directory });
    // macOS may canonicalize /var to /private/var.
    assert.ok(result.stdout.trim().endsWith(directory.replace(/^\/private/, "")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Nu errors and external exit codes are surfaced", async () => {
  const syntax = await runNu('this-command-does-not-exist', { cwd });
  assert.notEqual(syntax.exitCode, 0);
  assert.ok(syntax.stderr.length > 0);
  const external = await runNu('^sh -c "exit 7"', { cwd });
  assert.equal(external.exitCode, 7);
  const formatted = await formatOutput(external);
  assert.match(formatted.text, /Exit code: 7/);
});

test("timeout kills external descendants holding output pipes", async () => {
  const start = Date.now();
  const result = await runNu('^sh -c "sleep 30 & wait"', { cwd, timeout: 0.2 });
  assert.equal(result.stopped, "timeout");
  assert.ok(Date.now() - start < 3000);
});

test("abort before and during execution", async () => {
  const already = await runNu('print nope', { cwd, signal: AbortSignal.abort() });
  assert.equal(already.stopped, "cancelled");
  assert.equal(already.stdout, "");
  const result = await runNu('sleep 30sec', { cwd, signal: AbortSignal.timeout(150) });
  assert.equal(result.stopped, "cancelled");
});

test("missing executable rejects without crashing the parent", async () => {
  await assert.rejects(runNu('print 1', { cwd, executable: '/nonexistent/pi-nu-test' }), /ENOENT/);
});

test("capture limit bounds memory and marks output incomplete", async () => {
  const result = await runNu('0..10000 | each { print "abcdefghij" } | ignore', { cwd, maxCaptureBytes: 1024 });
  assert.equal(result.stopped, "capture limit");
  assert.ok(Buffer.byteLength(result.stdout) <= 1024);
  const output = await formatOutput(result);
  try {
    assert.match(output.text, /incomplete: capture limit/);
    assert.ok(output.fullOutputPath);
  } finally { if (output.fullOutputPath) await rm(dirname(output.fullOutputPath), { recursive: true }); }
});

test("preview limits preserve captured output in a private file", async () => {
  for (const stdout of ['x'.repeat(60000), 'row\n'.repeat(2100)]) {
    const output = await formatOutput({ stdout, stderr: '', exitCode: 0, terminationSignal: null });
    try {
      assert.equal(output.truncated, true);
      assert.ok(output.fullOutputPath);
      assert.equal(await readFile(output.fullOutputPath, 'utf8'), stdout);
    } finally { if (output.fullOutputPath) await rm(dirname(output.fullOutputPath), { recursive: true }); }
  }
});

test("timeout validation", async () => {
  for (const timeout of [0, -1, Infinity, 3601]) {
    await assert.rejects(runNu('print 1', { cwd, timeout }), /timeout must/);
  }
});
