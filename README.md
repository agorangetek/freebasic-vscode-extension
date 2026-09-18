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
  start. After `Dim x As` you get types; after `End` you get `Sub`, `Function`,
  `Select`, …; mid-expression you get functions and operators without the
  statement keywords getting in the way.
* **Blocks that close themselves** — accepting `Function`, `Sub`, `Type`, `If`,
  `For`, `Do`, `While`, `Select Case`, … at the start of a statement inserts the
  whole skeleton, closer included. Accepting `Function` gives:

  ```freebasic
  Function name() As Integer

  End Function
  ```

  Keywords are inserted capitalised, matching the label the completion list
  showed. The openers and their terminators are read from the manual's
  block-terminator page (`KeyPgEndblock`), which is the only place `End Function`
  is documented — there is no page for the combination itself.
* **Call snippets** — functions with parameters insert a snippet with
  tab stops, e.g. `Left(str, n)` arrives as `Left(${1:str}, ${2:n})`.
* **Smart casing** — completion matches however you type, but always inserts
  the conventional spelling (`ScreenRes`, `GetMouse`, `InKey` — the manual's
  own `Screenres`/`Inkey` are overridden by what example code actually uses).

Casing is learned at generation time from ~1,500 programs in the FreeBASIC
`examples/` tree, so proposals look like the code people really write.

### Format Text — canonical casing

FreeBASIC does not care about case, so the extension will fix it for you.
`FreeBASIC: Format Text (Capitalize Keywords)` is on the editor context menu
(right-click), in the command palette, and as a formatter for
*Format Document* / *Format Selection*.

It rewrites every name it knows a spelling for — keywords, datatypes, built-in
functions, block terminators, and the symbols the document itself declares — and
leaves everything else byte for byte. Comments and string literals are never
touched, so `"screenres"` in a message or an `Alias` string stays as written, and
a call is normalised to however the procedure was declared.

```freebasic
sub main()                          Sub main()
  dim x as double                     Dim x As Double
  screenres 640, 480          ->      ScreenRes 640, 480
  print left("dim", 3)               Print Left("dim", 3)
end sub                             End Sub
```

### Hover and signature help

Hovering a built-in shows its summary, syntax and manual category. Inside a
call, the signature help widget highlights the parameter you are on and
documents it.

### Highlighting scopes

The grammar scopes more than it used to, so a theme can colour things
consistently. Every scope below is specific to FreeBASIC, which means a
`textMateRules` entry can target it without touching other languages:

| what | scope |
| --- | --- |
| keywords (`Dim`, `If`, `End`, `As`, `Print`, …) | `keyword.control|operator|other.*.freebasic` |
| procedure names, declared and called | `entity.name.function.freebasic` |
| built-in functions (`Left`, `ScreenRes`, …) | `support.function.*.freebasic` |
| type names (`Vec2`) | `entity.name.type.freebasic` |
| datatypes (`Integer`, `Double`) | `storage.type.*.freebasic` |
| declared variables | `variable.other.freebasic` |

To colour them, add rules such as:

```jsonc
"editor.tokenColorCustomizations": {
    "textMateRules": [
        { "scope": ["source.freebasic keyword.control"], "settings": { "foreground": "#7ee787" } }
    ]
}
```

Note the `source.freebasic` prefix — it keeps the rule to this language.
Wrapping the setting in a `"[freebasic]"` block does **not** work for token
colours; it is silently ignored.

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
* **FreeBASIC: Format Text (Capitalize Keywords)** (`freebasic.formatText`) — fix
  identifier casing in the selection, or in the whole file. On the editor
  context menu, and registered as the formatter for the language.

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
