# FreeBASIC Language Support

FreeBASIC language support for Visual Studio Code: syntax highlighting, code
completion, hovers, signature help and a document outline.

## Features

### Code completion

Completion covers the whole language surface, not just keywords:

* **634 built-in names** generated from the official FreeBASIC manual — every
  intrinsic function, statement and keyword, with its real signature, summary
  and manual category.
* **Your own symbols** — procedures, types, enums, constants, `#define`s,
  variables and labels, indexed from the current file and (optionally) from
  every `.bas`/`.bi` file in the workspace.
* **Context awareness** — keywords are only offered where a statement can
  start; after `Dim x As` you get types, after `End` you get `Sub`/`Function`/…
* **Call snippets** — functions with parameters insert a snippet with
  tab stops, e.g. `Left(str, n)` arrives as `Left(${1:str}, ${2:n})`.
* **Smart casing** — completion matches however you type, but always inserts
  the conventional spelling (`ScreenRes`, `GetMouse`, `InKey` — the manual's
  own `Screenres`/`Inkey` are overridden by what example code actually uses).

Casing is learned at generation time from ~1,500 programs in the FreeBASIC
`examples/` tree, so proposals look like the code people really write.

### Hover and signature help

Hovering a built-in shows its summary, syntax and manual category. Inside a
call, the signature help widget highlights the parameter you are on and
documents it.

### Outline and workspace index

`Go to Symbol` lists procedures, types, enums, constants and labels. With
`freebasic.index.workspace` enabled, symbols from every `.bas`/`.bi` file in the
workspace are completed across modules.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `freebasic.completion.enable` | `true` | Master switch for completion. |
| `freebasic.completion.keywords` | `true` | Offer language keywords. |
| `freebasic.completion.builtins` | `true` | Offer built-in functions and statements. |
| `freebasic.completion.snippets` | `true` | Insert call snippets with parameter placeholders. |
| `freebasic.index.workspace` | `true` | Index `.bas`/`.bi` files across the workspace. |
| `freebasic.index.maxFiles` | `400` | Cap on indexed workspace files. |
| `freebasic.trace.server` | `"off"` | Log language service activity to the *FreeBASIC* output channel. |

## Commands

* **FreeBASIC: Rebuild Symbol Index** (`freebasic.reindex`) — re-scan the workspace.
* **FreeBASIC: Show Symbol Index Statistics** (`freebasic.showIndexStats`) — how
  many files and symbols were indexed.

## Building from source

```sh
npm install
npm run check     # typecheck + unit tests + bundle
npm run package   # produces freebasic-<version>.vsix
```

The completion database is generated from the FreeBASIC manual and is committed
to `src/data/`. To refresh it against a newer manual checkout:

```sh
node tools/gen-data.mjs /path/to/fbc
```

That reads `doc/manual/cache/KeyPg*.wakka` plus `examples/**/*.bas` from the
FreeBASIC source tree and rewrites `src/data/fb-builtins.json` /
`fb-builtins.ts`.

The language service lives in `src/service/` and deliberately does not import
`vscode`, so it can be unit-tested directly with `node --test` on Node 18+.

## Requirements

FreeBASIC 1.09.0 or newer. The extension does not ship or invoke the compiler —
it is a language service only.

## Known limitations

* No diagnostics; `fbc` is not run in the background.
* No rename/refactor actions yet; completion, hover, signature help and outline only.
* Workspace indexing is capped (`freebasic.index.maxFiles`) and re-runs on demand.
