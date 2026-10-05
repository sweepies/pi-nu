# pi-nu

A Nushell execution tool for Pi. Returns native Nu output; the model can use
`| to json` when useful.

## Install

Requires `nu` on Pi's PATH. Tested with Nu 0.116.0 and Pi 1.0.2.

```sh
pi install git:github.com/sweepies/pi-nu
```

Run `/reload` in an existing session. If Nu is missing or fails its startup check,
the extension warns and disables the tool. Fix PATH or install Nu, then `/reload`.

To try a local checkout without installing:

```sh
pi -e ./index.ts
```

## Usage

The `nu` tool accepts Nushell source and an optional timeout in seconds:

```json
{
  "command": "ls | where type == file | sort-by size --reverse | first 5",
  "timeout": 60
}
```

- Runs in Pi's working directory, inheriting its environment.
- Each call starts a fresh shell without user config, env files, or history.
  Use `use` to load custom modules. Stdin is closed.
- Disables Nu colors and uses plain errors. Stderr is labeled separately.
- Timeout defaults to 60 seconds; accepts values greater than zero up to 3600.
  Cancellation and timeout kill the process group on macOS/Linux; on Windows,
  only the Nu process is killed.
- Output preview is limited to 2000 lines / 50 KiB. Larger captured output is
  saved to a temporary file for follow-up reads.
- Execution stops at 16 MiB captured output and marks the result incomplete.

Native tables may abbreviate cells or omit columns. Use `| to json` when exact
values matter.

## Development

Requires Node 22.19+ and Nu. Process-group tests also require POSIX `sh`.

```sh
npm ci --ignore-scripts
npm run check
npm test
```
