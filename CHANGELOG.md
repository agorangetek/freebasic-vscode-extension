# Change Log

All notable changes to the "freebasic" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.1] - 2026-09-20

### Fixed

- **Typing `str`, `left`, `mid`, `len` or any other String library command never brought up
  the completion list.** Two scopes put the word `string` in front of the editor: the
  library group `support.function.string.freebasic` and the type
  `storage.type.string.freebasic`. VS Code derives the suggestions category of the token
  under the caret from its *innermost* scope with
  `/\b(comment|string|regex|regexp)\b/`, and string suggestions default to off, so the
  editor classified code as a string literal and never asked the extension. They are now
  `support.function.stringlib.freebasic` and `storage.type.stringtype.freebasic`; a theme
  that targeted either old name needs the new one.
- Two library scopes were misspelled `frebasic` (`support.function.input-output.frebasic`
  and `support.function.string.frebasic`), so no theme could colour those rules.

### Added

- Regression tests that tokenize all 884 built-in names and fail if any of them is
  classified as a string or a comment -- the trap above cannot come back unnoticed.

## [0.2.0] - 2026-09-20

Modernization of the extension into a full language service. The previous
release was a syntax-highlighting-only TextMate grammar.

### Added

- **Code completion**, backed by a database of 634 built-in names (functions,
  statements and keywords) generated from the official FreeBASIC manual, plus
  symbols parsed from the current document and the workspace.
- **Block scaffolds**: accepting `Function`, `Sub`, `Type`, `If`, `For`, `Do`,
  `While`, `Select Case`, … at the start of a statement inserts the whole block
  with its terminator. The 17 openers and their terminators are generated from
  the manual's block-terminator page (`KeyPgEndblock`).
- **Context-aware completion**: statement keywords only where a statement can
  start, types after `As`, block terminators after `End`, and no statement
  keywords mid-expression.
- **Hover** documentation for built-ins: summary, syntax and manual category.
- **Signature help** while typing a call, highlighting the active parameter.
- **Document symbols / outline** for procedures, types, enums, constants and labels.
- **Workspace symbol index** across `.bas`/`.bi` files, refreshable with the
  `FreeBASIC: Rebuild Symbol Index` command.
- Settings under `freebasic.*` for enabling completion, keywords, built-ins,
  snippets, workspace indexing and tracing.
- `tools/gen-data.mjs`, which regenerates the completion database from
  `doc/manual/cache/KeyPg*.wakka`, folding every name it writes down to lower
  case, and carries the compiler's own keyword table so the words with no
  manual page of their own (`ptr`, `then`, `wend`, `once`) travel with it too.
- Unit tests for the parser, the completion engine and the generated data,
  runnable with `npm test` on stock Node (no VS Code required).

- **Format Text** (`freebasic.formatText`): folds the spelling of the language —
  keywords, datatypes, built-in functions, block terminators, preprocessor
  directives and intrinsic defines — down to lower case (`ScreenRes` ->
  `screenres`, `Left` -> `left`, `__FB_DARWIN__` -> `__fb_darwin__`), and leaves
  the author's own identifiers alone. Procedures, types, variables, constants,
  labels and parameters keep whatever case they were written with, at the
  declaration and at every use; `#include` is followed so a procedure declared
  in a `.bi` is recognised as the author's in the files that call it. Comments
  and string literals are left alone too. Available on the editor context menu,
  in the command palette, and through *Format Document* / *Format Selection*.

- **Everything the language provides is lower case**, the style fbc's own source
  and headers are written in: `dim`, `print`, `if`, `end sub`, `select case`,
  `left`, `screenres`, `__fb_darwin__`. Hover declarations and the signature-help
  parameter tooltips are folded too, parameter types and modifiers included
  (`Any Ptr` reads `any ptr`). Completion, the block scaffolds and Format Text
  all agree, so what the list shows is what gets inserted, and none of them
  re-cases a name the author wrote.

- **Fields and variables are scoped.** A type's fields, a member reached
  through `.` or `->`, and every use of a variable (not just its declaration)
  now carry a scope, so they stop falling back to the editor's default
  foreground while the declaration two lines above is coloured. Fields are
  `variable.other.member.freebasic`, variables are `variable.other.freebasic`,
  which a theme normally paints the same way.

- **Completion filters by prefix.** Typing a character now offers only the names
  that start with it. The editor's own filter is fuzzy and also matches at a word
  boundary inside a name, so `r` would offer `screenres` and `e` would offer
  `Parse`; the language service narrows the list to prefix matches before the
  editor sees it, and the prefix is what has actually been typed rather than the
  whole word under the cursor.

- **Completion matches in any case.** The editor filters the list a second time
  after the provider returns it, and each item now carries a `filterText`
  spelling the typed prefix exactly as it was typed, so `SC`, `sc` and `Sc` all
  keep `screenres`. The label, which is displayed and inserted, is unchanged.

### Fixed

- **Type names are highlighted consistently.** The grammar scoped a type name
  where it was declared (`type Vec2`) but not where it was used, so
  `dim x as Vec2`, `byref v as Vec2` and a function's return type fell through
  to the editor's default foreground — blue in one place, plain grey in another.
  A procedure's return type after the parameter list was missed even for
  built-in datatypes (`function f() as double`). A new `#type-references` rule,
  included everywhere `#standard-data-types` already was, scopes user-defined
  type names as types without disturbing the `storage.type.*` scopes built-in
  datatypes already had.
- **Procedure names are scoped**, so function and sub names can be coloured.
  They previously matched no rule at all: only names the grammar happened to
  list as built-ins were scoped, which left user procedures and newer built-ins
  (`ScreenRes`, `Locate`) at the editor's default foreground while older ones
  (`Cls`, `Print`) were coloured. Declarations, member prototypes, calls with
  parentheses and paren-less calls such as `drawBox 10, 10` are all covered now,
  and declared variables are scoped as `variable.other.freebasic` so that
  `dim a(10)` is not mistaken for a call to `a()`.
- Tokenization tests (`test/grammar.test.ts`) run the grammar through the same
  engine the editor uses, so every position a type name or procedure name can
  appear in is covered and regressions fail the build.

- **Cross-check against the compiler's keyword table.** `tools/gen-data.mjs` now
  reads `src/compiler/symb-keyword.bas` when a compiler checkout is available and
  reports keywords the manual data does not cover. It found several real gaps:
  `ImageCreate` was missing (its page names itself `**""ImageCreate""**`, and the
  name scan was picking up a bolded *parameter default* instead, producing a
  bogus `transparent_color` entry), `AndAlso`/`OrElse` were titled
  "Operator ANDALSO (…)"; and eight pages that merely mention "declare function"
  — `Type`, `As`, `Any`, `Declare`, `Override`, `FBARRAY`, `__Fastcall`,
  `__Thiscall` — were classified as procedures and inserted as calls.

- **A declaration that names several variables is fully indexed.** The parser
  read only the first name out of `dim a, b as integer` and `const X = 1, Y = 2`,
  so `b` and `Y` were missing from completion, the outline and Format Text. The
  declarator list is now split on top-level commas, so every name is recorded.
- **Type-first declarations no longer produce a symbol called `as`.** `dim as
  integer x`, `dim shared as integer counter` and `static shared as double acc`
  were read as declaring a variable named `as` and lost the real name; the type
  after `as` is now skipped, for built-in and user-defined types alike.
- **Locals and parameters stop leaking past `end sub`.** Completion treated the
  last procedure declared above the cursor as the enclosing one without checking
  where its body ended, so at module level — below the final procedure — that
  procedure's locals and parameters were still offered. The parser now records
  the closing line and the check uses it.
- **`npm test` runs on Node 22** by passing `--experimental-strip-types`, and the
  sources and tests are marked as ES modules so the module-type warning is gone.
- **Closing blocks highlight as one word.** `end sub` and `end function` were
  split into two tokens whenever no procedure body was open: `end` was
  `keyword.control` while `sub`/`function` fell back to a *begin* keyword, so the
  two halves were coloured differently — the report that started this, with
  `end if` as the counter-example that looked right. Two causes: `static sub`
  and `static function` were swallowed by the variable-declaration rule, so
  their bodies never opened; and a terminator with no open block had nothing to
  match it as a unit. Procedure declarations now accept a leading `static`, and
  the terminator rule matches `end <block>` whole, so a closer is always one
  token. Each keeps the scope its own construct uses, which is what makes it the
  same colour as the keyword that opened the block: `end sub` and `end type`
  like `sub` and `type`, `end if` and `end select` like `if` and `select`, the
  loop closers like their loops. `end sub` is one token whether or not a body is
  open around it (a prototype, a pasted snippet, a half-typed file).
- **`var` declarations are indexed.** `var x = 5` introduces a variable like any
  other declaration, but the parser's list of declaration keywords stopped at
  `dim`/`static`/`common`/`redim`/`extern`, so a `var` name never reached
  completion, hover or the outline. `var` is read like the rest, inferring its
  type from the initializer (`var a = 1, b = "x"` declares both, and the commas
  inside a call such as `var n = sum(1, 2)` do not split it).

### Changed

- **Rewritten in TypeScript** and bundled with esbuild into a single
  `dist/extension.js`; the extension entry point moved from the repository root
  to `src/extension.ts`.
- Extension host code and the language service are separated: `src/service/`
  has no `vscode` dependency, so it is testable in plain Node.
- `package.json` now declares `main`, `activationEvents`, language/grammar
  contributions and configuration explicitly, and no longer relies on the
  legacy typings shim.

### Removed

- The committed `node_modules`/typings and the checked-in build output that the
  old repository carried.
