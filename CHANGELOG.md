# Change Log

All notable changes to the "freebasic" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0] - Unreleased

Modernization of the extension into a full language service. The previous
release was a syntax-highlighting-only TextMate grammar.

### Added

- **Code completion**, backed by a database of 634 built-in names (functions,
  statements and keywords) generated from the official FreeBASIC manual, plus
  symbols parsed from the current document and the workspace.
- **Hover** documentation for built-ins: summary, syntax and manual category.
- **Signature help** while typing a call, highlighting the active parameter.
- **Document symbols / outline** for procedures, types, enums, constants and labels.
- **Workspace symbol index** across `.bas`/`.bi` files, refreshable with the
  `FreeBASIC: Rebuild Symbol Index` command.
- Settings under `freebasic.*` for enabling completion, keywords, built-ins,
  snippets, workspace indexing and tracing.
- `tools/gen-data.mjs`, which regenerates the completion database from
  `doc/manual/cache/KeyPg*.wakka`, and learns conventional identifier casing
  from the FreeBASIC `examples/` tree (so `ScreenRes`, `GetMouse` and `InKey`
  are proposed instead of the manual's `Screenres`/`Inkey`).
- Unit tests for the parser, the completion engine and the generated data,
  runnable with `npm test` on stock Node (no VS Code required).

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
