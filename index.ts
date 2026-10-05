import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatOutput, runNu } from "./runner.ts";

export default function nuExtension(pi: ExtensionAPI) {
  const tool = {
    name: "nu",
    label: "Nushell",
    description:
      "Execute Nushell commands in the current workspace, without user config or history. " +
      "Returns native Nu output; use `| to json` when useful. " +
      "Default timeout: 60 seconds (max 3600). Output is limited to 2000 lines / 50 KiB, " +
      "with larger output saved to a temporary file. Execution stops at 16 MiB captured output.",
    parameters: Type.Object({
      command: Type.String({ description: "Nushell source, passed directly to nu without Bash quoting.", minLength: 1 }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default 60).", exclusiveMinimum: 0, maximum: 3600 })),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async execute(_id: string, params: { command: string; timeout?: number }, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) {
      const result = await runNu(params.command, { cwd: ctx.cwd, timeout: params.timeout, signal });
      const output = await formatOutput(result);
      return {
        content: [{ type: "text" as const, text: output.text }],
        details: {
          exitCode: result.exitCode,
          terminationSignal: result.terminationSignal,
          stopped: result.stopped,
          truncated: output.truncated,
          fullOutputPath: output.fullOutputPath,
        },
        isError: result.exitCode !== 0 || result.stopped !== undefined,
      };
    },
  };

  // No processes during factory evaluation (e.g. pi --help/resource discovery).
  pi.registerTool({ ...tool, exposure: "hidden" });
  pi.on("session_start", async (_event, ctx) => {
    try {
      const result = await runNu("version | get version", { cwd: ctx.cwd, timeout: 5 });
      if (result.exitCode !== 0 || result.stopped || !result.stdout.trim()) {
        throw new Error(result.stderr.trim() || result.stopped || "nu failed its startup check");
      }
      pi.registerTool({ ...tool, exposure: "direct" });
    } catch (error) {
      pi.registerTool({ ...tool, exposure: "hidden" });
      const reason = error instanceof Error ? error.message : String(error);
      const warning = `nu tool disabled: Nushell is missing from PATH or could not start (${reason}). Install Nushell, then /reload.`;
      if (ctx.hasUI) ctx.ui.notify(warning, "warning");
      else console.error(warning);
    }
  });
}
