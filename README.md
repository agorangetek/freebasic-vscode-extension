# FreeBASIC Language Support

FreeBASIC language support for Visual Studio Code: syntax highlighting, code
completion, hovers, signature help and a document outline.

## Features

### Code completion

Completion covers the whole language surface, not just keywords:

* **634 built-in names** generated from the official FreeBASIC manual — every
  intrinsic function, statement and keyword, with its real signature, summary
  and manual category. Every one of them is lower case (`dim`, `print`,
  `end sub`, `left`, `screenres`), the style fbc's own source and headers are
  written in.
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
* **Prefix filtering, in any case** — typing a character offers only what
  *starts* with it, whatever case you type. The editor's own filter is fuzzy and
  also matches inside a name, so `r` would offer `screenres`; the language
  service narrows the list itself, and gives each item a `filterText` spelled
  with the case you typed so the editor's second pass cannot drop it either.
* **Call snippets** — functions with parameters insert a snippet with
  tab stops, e.g. `left(str, n)` arrives as `left(${1:str}, ${2:n})`.
* **Smart casing** — completion matches however you type, but always inserts the
  canonical spelling, and the canonical spelling is lower case: `ScreenRes`
  arrives as `screenres`, `Left` as `left`. Your own names are never re-cased.

The rule is one line long: **everything the language provides is lower case, and
your own identifiers — procedures, types, variables, constants, labels — are
left exactly as written.**

### Format Text — canonical casing

FreeBASIC does not care about case, so the extension will fix it for you.
`FreeBASIC: Format Text (Lower-case Keywords)` is on the editor context menu
(right-click), in the command palette, and as a formatter for
*Format Document* / *Format Selection*.

It folds the spelling of the *language* — keywords, datatypes, built-in
functions and statements, block terminators, preprocessor directives and
intrinsic defines — down to lower case, and leaves everything else byte for
byte:

* **Everything the language provides is lower case.** `ScreenRes` becomes
  `screenres`, `Left` becomes `left`, `ByVal` becomes `byval`, `__FB_DARWIN__`
  becomes `__fb_darwin__`, `#Include` becomes `#include`. The word list is the
  compiler's own keyword table plus the manual, so words with no manual page of
  their own (`ptr`, `then`, `wend`, `once`, `protected`) are covered too.
* **Your own identifiers are never touched** — procedures, types, variables,
  constants, labels and parameters alike. `drawBox`, `Vec2`, `WIDTH` and `myVar`
  are the author's business and keep whatever case they were written with, at
  the declaration and at every use. Declarations are followed through
  `#include`, so a procedure declared in a `.bi` is recognised as yours in the
  files that call it. A local `left` also keeps the built-in `left` out of the
  file, since the two cannot be told apart.
* **Comments and string literals are never touched**, so `"ScreenRes"` in a
  message or an `Alias` string stays as written.
* **Line endings are preserved**, and running it twice changes nothing the
  second time.

```freebasic
ScreenRes 640, 480                  screenres 640, 480
Print Left("dim", 3)                print left("dim", 3)
Dim MyVar As Double                 dim MyVar as double
Type Vec2                           type Vec2
End Sub                             end sub
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
| built-in functions (`left`, `screenres`, …) | `support.function.*.freebasic` |
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
* **FreeBASIC: Format Text (Lower-case Keywords)** (`freebasic.formatText`) — fold
  the language's names to lower case in the selection, or in the whole file. On
  the editor context menu, and registered as the formatter for the language.

## Building from source

```sh
npm install
npm run check     # typecheck + unit tests + bundle
npm run package   # produces freebasic-<version>.vsix
```

The completion database is generated from the FreeBASIC manual and is committed
to `src/data/`. The generator also reads the compiler's own keyword table
(`src/compiler/symb-keyword.bas`): its keywords travel with the data, so words
the manual gives no page of their own (`ptr`, `then`, `wend`, `once`) are still
folded by Format Text, and the generator reports any keyword the manual data
does not cover — which is how `ImageCreate` and the `AndAlso`/`OrElse` operators
were found missing. To refresh it against a newer manual checkout:

```sh
node tools/gen-data.mjs /path/to/fbc
```

That reads `doc/manual/cache/KeyPg*.wakka` plus `src/compiler/symb-keyword.bas`
from the FreeBASIC source tree and rewrites `src/data/fb-builtins.json` /
`fb-builtins.ts`. Every name it writes is already lower case.

The language service lives in `src/service/` and deliberately does not import
`vscode`, so it can be unit-tested directly with `node --test` against the `.ts`
sources. `npm test` passes `--experimental-strip-types`, so it works on Node 22.6
and newer (23.6+ strips types by default and accepts the flag harmlessly). The
bundled extension itself still runs on the Node inside VS Code.

## Requirements

FreeBASIC 1.09.0 or newer. The extension does not ship or invoke the compiler —
it is a language service only.

## Known limitations

* No diagnostics; `fbc` is not run in the background.
* No rename/refactor actions yet; completion, hover, signature help and outline only.
* Workspace indexing is capped (`freebasic.index.maxFiles`) and re-runs on demand.
