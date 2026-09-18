# FreeBASIC Language Support

FreeBASIC language support for Visual Studio Code: syntax highlighting, code
completion, hovers, signature help and a document outline.

## Features

### Code completion

Completion covers the whole language surface, not just keywords:

* **634 built-in names** generated from the official FreeBASIC manual — every
  intrinsic function, statement and keyword, with its real signature, summary
  and manual category. Language keywords are lower case (`dim`, `print`,
  `end sub`), following the style fbc's own source is written in; runtime library
  routines keep the spelling their headers use (`Left`, `ScreenRes`).
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
  function name() as integer

  end function
  ```

  The openers and their terminators are read from the manual's
  block-terminator page (`KeyPgEndblock`), which is the only place `end function`
  is documented — there is no page for the combination itself.
* **Prefix filtering** — typing a character offers only what *starts* with it.
  The editor's own filter is fuzzy and also matches inside a name, so `r` would
  offer `ScreenRes`; the language service narrows the list itself, which the
  editor can only reduce further.
* **Call snippets** — functions with parameters insert a snippet with
  tab stops, e.g. `Left(str, n)` arrives as `Left(${1:str}, ${2:n})`.
* **Smart casing** — completion matches however you type, but always inserts the
  canonical spelling: lower case for language keywords, and the runtime
  library's own spelling for library routines (`ScreenRes`, `GetMouse`, `Left`)
  rather than the manual's inconsistent `Screenres`/`Getmouse`/`Inkey`.

Keyword casing follows fbc's own source; the spelling of library routines is
learned at generation time from ~1,600 programs in the FreeBASIC `examples/`
tree, so proposals look like the code people really write.

### Format Text — canonical casing

FreeBASIC does not care about case, so the extension will fix it for you.
`FreeBASIC: Format Text (Capitalize Keywords)` is on the editor context menu
(right-click), in the command palette, and as a formatter for
*Format Document* / *Format Selection*.

It fixes the spelling of the *language* — keywords, datatypes, built-in
functions and block terminators — and leaves everything else byte for byte:

* **Your procedures and types get a capital first letter.** `drawBox` becomes
  `DrawBox` in the declaration and at every call site, and `type vec2` becomes
  `type Vec2`. Declarations are followed through `#include`, so a procedure
  declared in a `.bi` is capitalised in the files that call it.
* **Your variables, constants and labels are never touched** — `i`, `WIDTH` and
  `myVar` are the author's business. A local `left` also keeps the built-in
  `Left` out of the file, since the two cannot be told apart.
* **Comments and string literals are never touched**, so `"screenres"` in a
  message or an `Alias` string stays as written.
* **Line endings are preserved**, and running it twice changes nothing the
  second time.

```freebasic
sub main()                          sub Main()
  dim x as double                     dim x as double
  ScreenRes 640, 480                  ScreenRes 640, 480
  print left("dim", 3)                print Left("dim", 3)
end sub                             end sub
```

### Hover and signature help

Hovering a built-in shows its summary, syntax and manual category. Inside a
call, the signature help widget highlights the parameter you are on and
documents it.

### Highlighting scopes

The grammar scopes more than it used to, so a theme can colour things
consistently. Every scope below is specific to FreeBASIC, which means a
`textMateRules` entry can target it without touching other languages.

They are also the *conventional* TextMate scopes, deliberately: a theme colours
FreeBASIC the same way it colours C# or any other language, with no per-language
configuration. Under VS Code's default dark theme that means blue keywords, pink
control flow, teal type names and yellow methods.

| what | scope |
| --- | --- |
| keywords (`Dim`, `If`, `End`, `As`, `Print`, …) | `keyword.control|operator|other.*.freebasic` |
| procedure names, declared and called | `entity.name.function.freebasic` |
| built-in functions (`Left`, `ScreenRes`, …) | `support.function.*.freebasic` |
| type names (`Vec2`) | `entity.name.type.freebasic` |
| datatypes (`Integer`, `Double`) | `storage.type.*.freebasic` |
| variables, where declared and where used | `variable.other.freebasic` |
| type fields and member access (`v.x`) | `variable.other.member.freebasic` |

To colour them differently, add rules such as:

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
to `src/data/`. The generator also cross-checks its result against the compiler's
own keyword table (`src/compiler/symb-keyword.bas`) and reports any keyword the
manual data does not cover, which is how `ImageCreate` and the `AndAlso`/`OrElse`
operators were found missing. To refresh it against a newer manual checkout:

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
