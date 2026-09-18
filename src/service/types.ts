/*
 * Shared types for the FreeBASIC language service.
 *
 * Everything in src/service/ is editor-agnostic: it must not import 'vscode',
 * so it can be unit-tested with plain node and reused by another editor
 * front-end (or an LSP wrapper) later.
 *
 * Note: the service is written in "erasable syntax only" TypeScript (no enums,
 * no namespaces, no parameter properties) so node can run and test the .ts
 * sources directly via type stripping.
 */

export type FbSymbolKind =
	| 'sub'
	| 'function'
	| 'constructor'
	| 'destructor'
	| 'property'
	| 'operator'
	| 'type'
	| 'union'
	| 'enum'
	| 'namespace'
	| 'class'
	| 'const'
	| 'define'
	| 'variable'
	| 'parameter'
	| 'label';

/** A symbol declared in FreeBASIC source. */
export interface FbSymbol {
	name: string;
	kind: FbSymbolKind;
	/** Zero-based line of the declaration. */
	line: number;
	/** The declaration line, trimmed, for display. */
	detail: string;
	/** Enclosing procedure for locals, or '' at module level. */
	scope: string;
	/** Procedures: parameter list as written (between the parentheses). */
	params?: string;
	/** Procedures: return type as written, when present. */
	returns?: string;
	/** Absolute path (or uri) of the file the symbol came from. */
	file: string;
	/** Absolute path of the file that #included it; '' for the root document. */
	includedFrom?: string;
	/** Extra text for hover (documentation comment above the declaration). */
	doc?: string;
}

export interface FbDocument {
	uri: string;
	text: string;
	/** Symbols declared in this document, module level and locals. */
	symbols: FbSymbol[];
	/** Raw #include targets, in order. */
	includes: string[];
}

export interface FbBuiltinParam {
	mode?: string;
	name: string;
	type?: string;
}

export interface FbBuiltinSignature {
	/** Full declaration line, e.g. "declare function Left ( byref str as const string, ... ) as string" */
	text: string;
	/** Compact call label, e.g. "Left(str, n)" */
	label: string;
	params: FbBuiltinParam[];
}

export interface FbBuiltin {
	/** Stable unique key: "<name>|<kind>", disambiguated with the page name for duplicates. */
	id: string;
	name: string;
	title: string;
	kind: 'function' | 'sub' | 'keyword';
	category: string;
	summary: string;
	usage?: string[];
	signatures: FbBuiltinSignature[];
	dialect: string[];
	url: string;
	page: string;
}

/** A compound statement block: what opens it and what closes it. */
export interface FbBlock {
	/** The word(s) that open the block, e.g. "Select Case". */
	opener: string;
	/** The word(s) that close it, e.g. "End Select", "Next", "Wend". */
	closer: string;
	/** Manual page documenting the opener. */
	page: string;
}

export interface FbBuiltinData {
	source: string;
	/** Absolute path of the manual checkout this data was generated from. */
	generatedFrom?: string;
	count: number;
	/** Block constructs, from the manual's KeyPgEndblock terminator list. */
	blocks: FbBlock[];
	items: FbBuiltin[];
}

export type FbCompletionKind =
	| 'function'
	| 'sub'
	| 'method'
	| 'variable'
	| 'field'
	| 'constant'
	| 'type'
	| 'keyword'
	| 'operator'
	| 'label';

export interface FbCompletionItem {
	label: string;
	kind: FbCompletionKind;
	detail: string;
	/** Markdown documentation, shown in the completion popup and on hover. */
	documentation?: string;
	/** Text or snippet to insert. */
	insertText: string;
	/** Whether insertText contains snippet placeholders (${1:name}). */
	isSnippet: boolean;
	/** Lower sorts first: locals, document, workspace, builtins, keywords. */
	sortText: string;
	/** Extra prefix text used for filtering only. */
	filterText?: string;
}

export interface FbHover {
	/** Markdown. */
	contents: string;
	/** 0-based line/character range of the hovered word. */
	range: { startLine: number; startChar: number; endLine: number; endChar: number };
}

/** A parameter label is either literal text or a [start, end] offset pair into
 * the signature label, which is what editors need to highlight reliably. */
export type FbParameterLabel = string | [number, number];

export interface FbSignatureInfo {
	/** The call label, e.g. "Left(str, n)". */
	label: string;
	/** One entry per parameter, in order. */
	parameters: { label: FbParameterLabel; documentation?: string }[];
	/** Zero-based index of the active parameter. */
	activeParameter: number;
	documentation?: string;
}

export interface FbCompletionOptions {
	keywords: boolean;
	builtins: boolean;
	snippets: boolean;
}

/** A parsed token position: zero-based line and character. */
export interface FbPosition {
	line: number;
	character: number;
}
