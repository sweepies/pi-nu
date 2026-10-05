import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 50 * 1024;
export const MAX_OUTPUT_LINES = 2000;

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  timeout?: number;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  maxCaptureBytes?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  terminationSignal: NodeJS.Signals | null;
  stopped?: "timeout" | "cancelled" | "capture limit";
}

/** Spawn directly: source never passes through Bash or another quoting layer. */
export async function runNu(command: string, options: RunOptions): Promise<RunResult> {
  const timeout = options.timeout ?? 60;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) {
    throw new Error("timeout must be greater than 0 and at most 3600 seconds");
  }
  if (options.signal?.aborted) {
    return { stdout: "", stderr: "", exitCode: null, terminationSignal: null, stopped: "cancelled" };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(options.executable ?? "nu", [
      "--no-config-file", "--no-history", "--error-style", "plain", "--commands",
      "$env.config.use_ansi_coloring = false; " + command,
    ], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, NO_COLOR: "1", TERM: "dumb", COLUMNS: "120" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let stopped: RunResult["stopped"];
    const limit = options.maxCaptureBytes ?? MAX_CAPTURE_BYTES;

    const stop = (reason: NonNullable<RunResult["stopped"]>) => {
      if (stopped) return;
      stopped = reason;
      // Kill the process group too, including external commands launched by Nu.
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* The process may already have exited. */ }
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      const remaining = Math.max(0, limit - bytes);
      if (remaining) target.push(chunk.subarray(0, remaining));
      bytes += chunk.length;
      if (bytes > limit) stop("capture limit");
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    const timer = setTimeout(() => stop("timeout"), timeout * 1000);
    const abort = () => stop("cancelled");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (exitCode, terminationSignal) => {
      cleanup();
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode, terminationSignal, stopped,
      });
    });
  });
}

/** Head preview; persist the captured output whenever the preview is incomplete. */
export async function formatOutput(result: RunResult) {
  const output = result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : "");
  const byteLimited = Buffer.from(output).subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  // Remove a partial UTF-8 character if the byte boundary bisected one.
  const preview = byteLimited.replace(/\uFFFD$/, "").split("\n").slice(0, MAX_OUTPUT_LINES).join("\n");
  const truncated = preview !== output;
  let text = preview || "(no output)";
  let fullOutputPath: string | undefined;
  if (truncated || result.stopped === "capture limit") {
    const directory = await mkdtemp(join(tmpdir(), "pi-nu-"));
    fullOutputPath = join(directory, "output.txt");
    await writeFile(fullOutputPath, output, { mode: 0o600 });
    text += `\n\n[Output ${result.stopped === "capture limit" ? "incomplete: capture limit reached" : "truncated to 2000 lines / 50 KiB"}. Captured output saved to ${fullOutputPath}]`;
  }
  if (result.stopped) text += `\n[Stopped: ${result.stopped}]`;
  else if (result.exitCode !== 0) text += `\n[Exit code: ${result.exitCode}; signal: ${result.terminationSignal ?? "none"}]`;
  return { text, truncated, fullOutputPath };
}
