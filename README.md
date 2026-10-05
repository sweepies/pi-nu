# pi-nu

Adds a `nu` tool to Pi for Nushell commands. The model chooses the output format:
**native Nu output by default**, or explicit JSON when useful.
No automatic serialization.

## Load or install

Requires Nushell (`nu`) on Pi's PATH. Tested with Nu 0.116.0 and Pi 1.0.2.

Try for one session, from this package directory:

```sh
pi -e ./index.ts
```

Install persistently from GitHub:

```sh
pi install git:github.com/sweepies/pi-nu
```

Or install a local checkout with `pi install ./pi-nu` from its parent directory.
A local installation references this directory rather than copying it; keep it in
place. Run `/reload` in an existing Pi session after installing or changing it.
Pi supplies the runtime imports; no dependency installation is needed to use it.

At session start the extension probes Nu. If it is missing or cannot start, the
extension warns and keeps the tool hidden. Other tools continue working. Install
Nu or fix Pi's PATH, then `/reload` to retry. Non-UI warnings use stderr so they do
not corrupt JSON/RPC stdout.

## Tool input

```json
{
  "command": "ls | where type == file | sort-by size --reverse | first 5",
  "timeout": 60
}
```

`command` is Nushell source, passed directly to Nu (not interpreted by Bash).
`timeout` is optional, greater than zero and at most 3600 seconds; default 60.

For exact, JSON-compatible values the model can request:

```nu
ls | where type == file | select name size | to json
```

Native table rendering may omit columns or abbreviate values. It is not a lossless
serialization. JSON converts Nu-specific types according to Nu's serializer.

## Execution behavior

- Uses Pi's current working directory and inherits its environment.
- Each call gets a fresh non-interactive shell; stdin is closed.
- No user config, env file, or history. Explicitly `use` custom Nu modules if needed.
- Disables Nu ANSI coloring and requests plain errors. External programs may still
  emit their own control codes or formatting.
- stdout is shown as produced; stderr, if any, is appended under a separate label.
- Nonzero exits, cancellation, timeouts, and capture-limit stops are error results.
- Timeout/cancellation kills the process group on macOS/Linux, including ordinary
  external child processes. On Windows only the direct Nu process is killed;
  descendant cleanup is not guaranteed. Processes that detach into their own
  groups are also outside this cleanup guarantee.
- Model-facing preview is limited to 2000 lines / 50 KiB. Larger captured output
  is saved in a private temporary file, whose path is returned for the `read` tool.
- Total capture is capped at 16 MiB to bound memory. Exceeding it stops the command;
  the saved output is explicitly marked incomplete. Prefer filtering in Nu first.
- Temporary output files are retained for follow-up reads. They may contain
  sensitive data; delete them when no longer needed.

**Not a sandbox:** Nu can modify files and execute external programs. The tool is
annotated as potentially destructive and open-world. Permission hooks that match
only `bash` must be updated to cover `nu` too.

## Development

Node 22.19+ (native TypeScript stripping) is needed for the tests. Install dev
dependencies, then run:

```sh
npm ci --ignore-scripts
npm run check
npm test
```

Tests cover native/JSON output, quoting, cwd, errors/exit codes, timeout process
cleanup, cancellation, missing executable, capture limits, preview persistence,
and extension availability/warnings. Runner tests require Nu; process-group tests
use POSIX `sh` and are intended for macOS/Linux.
