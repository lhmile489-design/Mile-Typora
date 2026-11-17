import { useEffect, useImperativeHandle, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import type { Decoration as DecorationType, DecorationSet } from "@codemirror/view";
import type { AnnotationType, Extension, StateEffect } from "@codemirror/state";
import type { HeadingLevel, ParagraphEdit, Snapshot } from "../editor/paragraph";
import {
  imageAt,
  insertAlert,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertImageLink,
  insertLinkReference,
  insertTable,
  insertTOC,
  linkAt,
  removeLink,
  replaceImageAt,
  setLinkAddress,
  tableAddColumn,
  tableAddRow,
  tableAlign,
  tableDelete,
  tableDeleteColumn,
  tableDeleteRow,
  toggleUnderline,
  type AlertType,
  type TableAlign,
} from "../editor/extended";

type ParagraphModule = typeof import("../editor/paragraph");
type InlineModule = typeof import("../editor/inline");
type SearchModule = typeof import("../editor/search");
type LineOpsModule = typeof import("../editor/lineops");
type AssistModule = typeof import("../editor/editassist");
type MathModule = typeof import("../editor/mathtools");
type SmartPunctModule = typeof import("../editor/smartpunct");
type SpellCheckModule = typeof import("../editor/spellcheck");
type CodeToolsModule = typeof import("../editor/codetools");

/** Commands the app and, later, the Edit menu call on the editor. */
export type SourceCommands = {
  focus(): void;
  undo(): void;
  redo(): void;
  copy(): Promise<boolean>;
  cut(): Promise<boolean>;
  paste(): Promise<boolean>;
  /** Copies the selected source; false when nothing is selected. */
  copyMarkdown(): Promise<boolean>;
  /** Pastes clipboard text at the selection, ignoring rich formatting. */
  pastePlain(): Promise<boolean>;
  /** Inserts already-read clipboard text at the selection (M5-5). */
  insertText(text: string): boolean;
  selectionText(): string;
  /** Paragraph commands (P1 PARA-01..07, 10..17, 20). */
  setHeading(level: HeadingLevel): boolean;
  setParagraph(): boolean;
  promoteHeading(): boolean;
  demoteHeading(): boolean;
  toggleQuote(): boolean;
  toggleOrderedList(): boolean;
  toggleUnorderedList(): boolean;
  toggleTaskList(): boolean;
  /** Menu command, wired with the M4-7 paragraph menu. */
  setTaskStatus(checked: boolean): boolean;
  /** Menu command, wired with the M4-7 paragraph menu. */
  indentList(direction: "in" | "out"): boolean;
  /** Menu command, wired with the M4-7 paragraph menu. */
  insertParagraph(where: "above" | "below"): boolean;
  /** Menu command, wired with the M4-7 paragraph menu. */
  insertHorizontalRule(): boolean;
  insertFormulaBlock(): boolean;
  insertCodeBlock(language?: string): boolean;
  /** Inline formatting (P1 FORMAT-01/02/04/05/07/10). */
  toggleBold(): boolean;
  toggleItalic(): boolean;
  toggleInlineCode(): boolean;
  toggleStrikethrough(): boolean;
  insertLink(): boolean;
  clearFormatting(): boolean;
  /** P2 table commands (M5-3 PARA-05). */
  insertTable(rows: number, columns: number): boolean;
  tableAddRow(where: "above" | "below"): boolean;
  tableAddColumn(where: "left" | "right"): boolean;
  tableDeleteRow(): boolean;
  tableDeleteColumn(): boolean;
  tableDelete(): boolean;
  tableAlign(align: TableAlign): boolean;
  /** P2 extended block and inline commands (M5-3). */
  insertFootnote(): boolean;
  insertAlert(type: AlertType): boolean;
  insertLinkReference(): boolean;
  insertTOC(): boolean;
  insertFrontMatter(): boolean;
  toggleUnderline(): boolean;
  insertComment(): boolean;
  /** Link operations (M5-4 FORMAT-08). */
  linkInfo(): { text: string; url: string; reference: boolean } | null;
  setLinkAddress(address: string): boolean;
  removeLink(): boolean;
  /** Image operations (M5-4 FORMAT-09). */
  imageInfo(): { alt: string; url: string } | null;
  insertImage(markdown: string, alt: string): boolean;
  replaceImage(markdown: string): boolean;
  /** Math tools (M6-2 EDIT-17). */
  insertInlineMath(): boolean;
  insertMathSnippet(kind: import("../editor/mathtools").MathSnippet): boolean;
  convertMathDelimiter(target: import("../editor/mathtools").MathDelimiter): boolean;
  mathInfo(): { tex: string; display: boolean; kind: "inline" | "block" } | null;
  /** Code tools (P3 M6-5 PARA-08). Each is one undo step. */
  codeIndentSpaces(width: 2 | 4): boolean;
  /** Returns the count of lines that kept their indent (not a 4-column multiple). */
  codeIndentTabs(): { applied: boolean; skipped: number };
  codeLowercaseLanguage(): boolean;
  /** Editing aids (M5-8 EDIT-16/20). */
  deleteWord(): boolean;
  deleteLine(): boolean;
  deleteParagraph(): boolean;
  trimTrailingWhitespace(): boolean;
  ensureFinalNewline(): boolean;
  /** Switches the whole buffer's line ending (M5-8 EDIT-19). */
  convertLineEnding(ending: "LF" | "CRLF"): boolean;
  selectAll(): void;
  selectLine(): boolean;
  selectParagraph(): boolean;
  /** Moves the cursor to a 1-based source line (M5-2 outline). */
  goToLine(line: number): void;
  moveLine(direction: "up" | "down"): boolean;
  deleteForward(): boolean;
  find(query: string): { count: number; index: number };
  stepFind(query: string, index: number, backwards: boolean): { count: number; index: number };
  replace(query: string, replacement: string, index: number): { count: number; index: number; replaced: boolean };
  replaceAll(query: string, replacement: string): { count: number; replaced: number };
};

type Props = {
  /** The buffer the editor shows; changing it replaces the document. */
  value: string;
  /** Called on every user edit, with the whole buffer. */
  onChange: (value: string) => void;
  /** Clipboard through the app's native binding, not the WebView permission. */
  readClipboard: () => Promise<string | null>;
  writeClipboard: (text: string) => Promise<boolean>;
  /** Reports what sits under the caret, for menu enablement. */
  onContext?: (context: EditorContext) => void;
  /** Dims every paragraph except the one holding the caret (M5-7 VIEW-07). */
  focusMode?: boolean;
  /** Keeps the caret line at about 40% of the viewport (VIEW-08). */
  typewriter?: boolean;
  /** The document's current line ending: LF, CRLF, or 混合 (M5-8). */
  lineEnding?: string;
  /** Reports a line-ending conversion so the app can mark the buffer dirty. */
  onLineEndingChange?: (lineEnding: string) => void;
  /** Converts new typed input to CJK punctuation (M6-3 EDIT-18). */
  smartPunctuation?: boolean;
  /** Underlines misspelled English words in the source editor (M6-4 EDIT-21). */
  spellCheck?: boolean;
  ref?: React.Ref<SourceCommands>;
};

export type EditorContext = {
  inTable: boolean;
  inLink: boolean;
  inImage: boolean;
  hasSelection: boolean;
  /** The editor owns keyboard focus (M5-8 delete ranges need it). */
  focused: boolean;
  /** The caret is inside a math formula (M6-2). */
  inMath: boolean;
  /** The caret is in code, front matter or another math-blocked region. */
  mathBlocked: boolean;
  /** The caret or selection sits inside one fenced code block (M6-5). */
  inFence: boolean;
  /** Lowercased info token of that fence ("" when not in a fence or no info). */
  fenceLanguage: string;
  /** The selection crosses a fence boundary; commands must refuse (M6-5). */
  crossFence: boolean;
};

/**
 * The Markdown source editor (PRD 10.1, M4-1). CodeMirror is imported only
 * when editing starts, so reading pays nothing for it. The buffer is the
 * editor's document; preview renders the same string through Go.
 */
export function SourceEditor({ value, onChange, readClipboard, writeClipboard, onContext, focusMode = false, typewriter = false, lineEnding = "LF", onLineEndingChange, smartPunctuation = false, spellCheck = false, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contextRef = useRef(onContext);
  contextRef.current = onContext;
  const valueRef = useRef(value);
  valueRef.current = value;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const readClipboardRef = useRef(readClipboard);
  readClipboardRef.current = readClipboard;
  const writeClipboardRef = useRef(writeClipboard);
  writeClipboardRef.current = writeClipboard;
  const applying = useRef(false);
  const historyActions = useRef<{
    undo: (view: EditorView) => boolean;
    redo: (view: EditorView) => boolean;
  } | null>(null);
  const paragraph = useRef<ParagraphModule | null>(null);
  const inline = useRef<InlineModule | null>(null);
  const search = useRef<SearchModule | null>(null);
  const lineops = useRef<LineOpsModule | null>(null);
  const assist = useRef<AssistModule | null>(null);
  const mathTools = useRef<MathModule | null>(null);
  const codeTools = useRef<CodeToolsModule | null>(null);
  const smartPunct = useRef<SmartPunctModule | null>(null);
  const isolateHistory = useRef<AnnotationType<"after" | "before" | "full"> | null>(null);
  const stateCtor = useRef<typeof import("@codemirror/state").EditorState | null>(null);
  const extensions = useRef<Extension[] | null>(null);
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  const typewriterRef = useRef(typewriter);
  typewriterRef.current = typewriter;
  const lineEndingRef = useRef(lineEnding);
  lineEndingRef.current = lineEnding;
  const smartPunctuationRef = useRef(smartPunctuation);
  smartPunctuationRef.current = smartPunctuation;
  const spellCheckRef = useRef(spellCheck);
  spellCheckRef.current = spellCheck;
  const spellChecker = useRef<{ check(word: string): boolean; suggest(word: string, limit?: number): string[] } | null>(null);
  const spellCheckModule = useRef<SpellCheckModule | null>(null);
  const spellScanTimer = useRef<number | null>(null);
  const spellMenu = useRef<{ open: boolean; word: string; suggestions: string[] } | null>(null);
  // Live handles assigned inside the mount effect so the enable/disable effects
  // (declared before it) can still reach them (M6-4 EDIT-21).
  const spellFieldRef = useRef<import("@codemirror/state").StateField<DecorationSet> | null>(null);
  const scheduleScanRef = useRef<((view: EditorView, delay?: number) => void) | null>(null);
  const closeSpellMenuRef = useRef<() => void>(() => {});
  // Runtime bindings stored after the lazy imports resolve so the toggle-off
  // effect can clear decorations without re-importing CodeMirror.
  const clearSpellMarksRef = useRef<((view: EditorView) => void) | null>(null);
  const onLineEndingChangeRef = useRef(onLineEndingChange);
  onLineEndingChangeRef.current = onLineEndingChange;
  // A conversion changes no text, so CodeMirror's history cannot hold it.
  // These hold the one conversion that is still the latest action.
  const lineUndo = useRef<{ from: string; to: string } | null>(null);
  const lineRedo = useRef<{ from: string; to: string } | null>(null);
  // The line ending this editor last set itself. A different prop value means
  // the document was loaded or discarded, so the conversion history is stale.
  const expectedLineEnding = useRef(lineEnding);
  const focusEffectRef = useRef<((value: boolean) => StateEffect<boolean>) | null>(null);
  const scrollTypewriterRef = useRef<(() => void) | null>(null);
  const viewCleanup = useRef<(() => void) | null>(null);

  /** applyEdit dispatches one transaction so one command is one undo step. */
  const applyEdit = (edit: ParagraphEdit, focus = true): boolean => {
    const view = viewRef.current;
    if (!view || !edit) return false;
    const current = view.state.doc.toString();
    if (current !== edit.text) {
      let start = 0;
      while (start < current.length && start < edit.text.length && current[start] === edit.text[start]) start++;
      let oldEnd = current.length;
      let newEnd = edit.text.length;
      while (oldEnd > start && newEnd > start && current[oldEnd - 1] === edit.text[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      view.dispatch({
        changes: { from: start, to: oldEnd, insert: edit.text.slice(start, newEnd) },
        selection: { anchor: edit.anchor, head: edit.head },
        scrollIntoView: true,
        annotations: isolateHistory.current ? [isolateHistory.current.of("full")] : undefined,
      });
    } else {
      view.dispatch({ selection: { anchor: edit.anchor, head: edit.head }, scrollIntoView: true });
    }
    if (focus) view.focus();
    return true;
  };

  /** runParagraph gives a pure transform a fresh snapshot and one dispatch. */
  const runParagraph = (transform: (mod: ParagraphModule, snapshot: Snapshot) => ParagraphEdit): boolean => {
    const view = viewRef.current;
    const mod = paragraph.current;
    if (!view || !mod) return false;
    const range = view.state.selection.main;
    return applyEdit(transform(mod, { text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
  };

  /** selectMatch moves the editor selection without stealing find-input focus. */
  const selectMatch = (from: number, to: number): void => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  };

  /** runInline is the same contract for the inline formatting transforms. */
  const runInline = (transform: (mod: InlineModule, snapshot: Snapshot) => ParagraphEdit): boolean => {
    const view = viewRef.current;
    const mod = inline.current;
    if (!view || !mod) return false;
    const range = view.state.selection.main;
    return applyEdit(transform(mod, { text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
  };

  /** runExtended applies a pure P2 transform to the current buffer. */
  const runExtended = (transform: (snapshot: Snapshot) => ParagraphEdit): boolean => {
    const view = viewRef.current;
    if (!view) return false;
    const range = view.state.selection.main;
    return applyEdit(transform({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
  };

  /** runAssist is runExtended for the lazily loaded editing aids (M5-8). */
  const runAssist = (transform: (mod: AssistModule, snapshot: Snapshot) => ParagraphEdit): boolean => {
    const view = viewRef.current;
    const mod = assist.current;
    if (!view || !mod) return false;
    const range = view.state.selection.main;
    return applyEdit(transform(mod, { text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
  };

  /** runMath is runExtended for the lazily loaded math helpers (M6-2). */
  const runMath = (transform: (mod: MathModule, snapshot: Snapshot) => ParagraphEdit): boolean => {
    const view = viewRef.current;
    const mod = mathTools.current;
    if (!view || !mod) return false;
    const range = view.state.selection.main;
    return applyEdit(transform(mod, { text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
  };

  /** runCodeTools is the same contract for the fenced-code helpers (M6-5). */
  const runCodeTools = (transform: (mod: CodeToolsModule, snapshot: Snapshot) => ParagraphEdit): boolean => {
    const view = viewRef.current;
    const mod = codeTools.current;
    if (!view || !mod) return false;
    const range = view.state.selection.main;
    return applyEdit(transform(mod, { text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
  };

  useImperativeHandle(
    ref,
    (): SourceCommands => ({
      focus() {
        viewRef.current?.focus();
      },
      undo() {
        const conversion = lineUndo.current;
        if (conversion) {
          lineUndo.current = null;
          lineRedo.current = conversion;
          expectedLineEnding.current = conversion.from;
          onLineEndingChangeRef.current?.(conversion.from);
          viewRef.current?.focus();
          return;
        }
        const view = viewRef.current;
        if (!view || !historyActions.current) return;
        historyActions.current.undo(view);
        view.focus();
      },
      redo() {
        const conversion = lineRedo.current;
        if (conversion) {
          lineRedo.current = null;
          lineUndo.current = conversion;
          expectedLineEnding.current = conversion.to;
          onLineEndingChangeRef.current?.(conversion.to);
          viewRef.current?.focus();
          return;
        }
        const view = viewRef.current;
        if (!view || !historyActions.current) return;
        historyActions.current.redo(view);
        view.focus();
      },
      async copy() {
        const view = viewRef.current;
        if (!view) return false;
        const text = selectedText(view);
        if (text === "") return false;
        return writeClipboardRef.current(text);
      },
      async cut() {
        const view = viewRef.current;
        if (!view) return false;
        const text = selectedText(view);
        if (text === "") return false;
        const ok = await writeClipboardRef.current(text);
        if (!ok) return false;
        view.dispatch(view.state.replaceSelection(""));
        view.focus();
        return true;
      },
      async paste() {
        return this.pastePlain();
      },
      async copyMarkdown() {
        const view = viewRef.current;
        if (!view) return false;
        const text = selectedText(view);
        if (text === "") return false;
        return writeClipboardRef.current(text);
      },
      async pastePlain() {
        const view = viewRef.current;
        if (!view) return false;
        const text = await readClipboardRef.current();
        if (text === null || text === "") return false;
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
        return true;
      },
      insertText(text) {
        const view = viewRef.current;
        if (!view || text === "") return false;
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
        return true;
      },
      selectionText() {
        const view = viewRef.current;
        return view ? selectedText(view) : "";
      },
      setHeading(level) {
        return runParagraph((mod, snapshot) => mod.setHeading(snapshot, level));
      },
      setParagraph() {
        return runParagraph((mod, snapshot) => mod.setHeading(snapshot, 0));
      },
      promoteHeading() {
        return runParagraph((mod, snapshot) => mod.shiftHeading(snapshot, "promote"));
      },
      demoteHeading() {
        return runParagraph((mod, snapshot) => mod.shiftHeading(snapshot, "demote"));
      },
      toggleQuote() {
        return runParagraph((mod, snapshot) => mod.toggleQuote(snapshot));
      },
      toggleOrderedList() {
        return runParagraph((mod, snapshot) => mod.toggleList(snapshot, "ordered"));
      },
      toggleUnorderedList() {
        return runParagraph((mod, snapshot) => mod.toggleList(snapshot, "unordered"));
      },
      toggleTaskList() {
        return runParagraph((mod, snapshot) => mod.toggleList(snapshot, "task"));
      },
      setTaskStatus(checked) {
        return runParagraph((mod, snapshot) => mod.setTaskStatus(snapshot, checked));
      },
      indentList(direction) {
        return runParagraph((mod, snapshot) => mod.indentList(snapshot, direction));
      },
      insertParagraph(where) {
        return runParagraph((mod, snapshot) => mod.insertParagraph(snapshot, where));
      },
      insertHorizontalRule() {
        return runParagraph((mod, snapshot) => mod.insertHorizontalRule(snapshot));
      },
      insertFormulaBlock() {
        return runParagraph((mod, snapshot) => mod.insertFence(snapshot, "formula"));
      },
      insertCodeBlock(language) {
        return runParagraph((mod, snapshot) => mod.insertFence(snapshot, "code", language));
      },
      toggleBold() {
        return runInline((mod, snapshot) => mod.toggleEmphasis(snapshot, "bold"));
      },
      toggleItalic() {
        return runInline((mod, snapshot) => mod.toggleEmphasis(snapshot, "italic"));
      },
      toggleInlineCode() {
        return runInline((mod, snapshot) => mod.toggleCode(snapshot));
      },
      toggleStrikethrough() {
        return runInline((mod, snapshot) => mod.toggleEmphasis(snapshot, "strikethrough"));
      },
      insertLink() {
        return runInline((mod, snapshot) => mod.insertLink(snapshot));
      },
      clearFormatting() {
        return runInline((mod, snapshot) => mod.clearFormatting(snapshot));
      },
      insertTable(rows, columns) {
        return runExtended((snapshot) => insertTable(snapshot, rows, columns));
      },
      tableAddRow(where) {
        return runExtended((snapshot) => tableAddRow(snapshot, where));
      },
      tableAddColumn(where) {
        return runExtended((snapshot) => tableAddColumn(snapshot, where));
      },
      tableDeleteRow() {
        return runExtended((snapshot) => tableDeleteRow(snapshot));
      },
      tableDeleteColumn() {
        return runExtended((snapshot) => tableDeleteColumn(snapshot));
      },
      tableDelete() {
        return runExtended((snapshot) => tableDelete(snapshot));
      },
      tableAlign(align) {
        return runExtended((snapshot) => tableAlign(snapshot, align));
      },
      insertFootnote() {
        return runExtended((snapshot) => insertFootnote(snapshot));
      },
      insertAlert(type) {
        return runExtended((snapshot) => insertAlert(snapshot, type));
      },
      insertLinkReference() {
        return runExtended((snapshot) => insertLinkReference(snapshot));
      },
      insertTOC() {
        return runExtended((snapshot) => insertTOC(snapshot));
      },
      insertFrontMatter() {
        return runExtended((snapshot) => insertFrontMatter(snapshot));
      },
      toggleUnderline() {
        return runExtended((snapshot) => toggleUnderline(snapshot));
      },
      insertComment() {
        return runExtended((snapshot) => insertComment(snapshot));
      },
      linkInfo() {
        const view = viewRef.current;
        if (!view) return null;
        const range = view.state.selection.main;
        const link = linkAt({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head });
        return link ? { text: link.text, url: link.url, reference: link.referenceLabel !== undefined } : null;
      },
      setLinkAddress(address) {
        return runExtended((snapshot) => setLinkAddress(snapshot, address));
      },
      removeLink() {
        return runExtended((snapshot) => removeLink(snapshot));
      },
      imageInfo() {
        const view = viewRef.current;
        if (!view) return null;
        const range = view.state.selection.main;
        const image = imageAt({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head });
        return image ? { alt: image.alt, url: image.url } : null;
      },
      insertImage(markdown, alt) {
        return runExtended((snapshot) => insertImageLink(snapshot, markdown, alt));
      },
      replaceImage(markdown) {
        return runExtended((snapshot) => replaceImageAt(snapshot, markdown));
      },
      insertMathSnippet(kind) {
        return runMath((mod, snapshot) => mod.insertMathSnippet(snapshot, kind));
      },
      insertInlineMath() {
        return runMath((mod, snapshot) => mod.insertInlineMath(snapshot));
      },
      convertMathDelimiter(target) {
        return runMath((mod, snapshot) => mod.convertMathDelimiter(snapshot, target));
      },
      mathInfo() {
        const view = viewRef.current;
        const mod = mathTools.current;
        if (!view || !mod) return null;
        const range = view.state.selection.main;
        return mod.mathInfo({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head });
      },
      codeIndentSpaces(width) {
        return runCodeTools((mod, snapshot) => mod.reindent(snapshot, width));
      },
      codeIndentTabs() {
        const view = viewRef.current;
        const mod = codeTools.current;
        if (!view || !mod) return { applied: false, skipped: 0 };
        const range = view.state.selection.main;
        const { edit, skipped } = mod.toTabs({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head });
        return { applied: applyEdit(edit), skipped };
      },
      codeLowercaseLanguage() {
        return runCodeTools((mod, snapshot) => mod.lowercaseLanguage(snapshot));
      },
      deleteWord() {
        return runAssist((mod, snapshot) => mod.deleteWord(snapshot));
      },
      deleteLine() {
        return runAssist((mod, snapshot) => mod.deleteLine(snapshot));
      },
      deleteParagraph() {
        return runAssist((mod, snapshot) => mod.deleteParagraph(snapshot));
      },
      trimTrailingWhitespace() {
        return runAssist((mod, snapshot) => mod.trimTrailingWhitespace(snapshot));
      },
      ensureFinalNewline() {
        return runAssist((mod, snapshot) => mod.ensureFinalNewline(snapshot));
      },
      convertLineEnding(ending) {
        const current = lineEndingRef.current;
        if (!current || current === ending) return false;
        lineRedo.current = null;
        lineUndo.current = { from: current, to: ending };
        expectedLineEnding.current = ending;
        onLineEndingChangeRef.current?.(ending);
        viewRef.current?.focus();
        return true;
      },
      selectAll() {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        view.focus();
      },
      selectLine() {
        const view = viewRef.current;
        const mod = lineops.current;
        if (!view || !mod) return false;
        const range = view.state.selection.main;
        return applyEdit(mod.selectLine({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
      },
      selectParagraph() {
        const view = viewRef.current;
        const mod = lineops.current;
        if (!view || !mod) return false;
        const range = view.state.selection.main;
        return applyEdit(mod.selectParagraph({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
      },
      goToLine(line) {
        const view = viewRef.current;
        if (!view) return;
        const number = Math.max(1, Math.min(Math.trunc(line), view.state.doc.lines));
        const from = view.state.doc.line(number).from;
        view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
        view.focus();
      },
      moveLine(direction) {
        const view = viewRef.current;
        const mod = lineops.current;
        if (!view || !mod) return false;
        const range = view.state.selection.main;
        return applyEdit(mod.moveLines({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head }, direction));
      },
      deleteForward() {
        const view = viewRef.current;
        const mod = lineops.current;
        if (!view || !mod) return false;
        const range = view.state.selection.main;
        return applyEdit(mod.deleteForward({ text: view.state.doc.toString(), anchor: range.anchor, head: range.head }));
      },
      find(query) {
        const view = viewRef.current;
        const mod = search.current;
        if (!view || !mod) return { count: 0, index: 0 };
        const matches = mod.findMatches(view.state.doc.toString(), query);
        if (matches.length === 0) return { count: 0, index: 0 };
        selectMatch(matches[0]!.from, matches[0]!.to);
        return { count: matches.length, index: 0 };
      },
      stepFind(query, index, backwards) {
        const view = viewRef.current;
        const mod = search.current;
        if (!view || !mod) return { count: 0, index: 0 };
        const matches = mod.findMatches(view.state.doc.toString(), query);
        if (matches.length === 0) return { count: 0, index: 0 };
        const next = (index + (backwards ? -1 : 1) + matches.length) % matches.length;
        selectMatch(matches[next]!.from, matches[next]!.to);
        return { count: matches.length, index: next };
      },
      replace(query, replacement, index) {
        const view = viewRef.current;
        const mod = search.current;
        if (!view || !mod) return { count: 0, index: 0, replaced: false };
        const text = view.state.doc.toString();
        const result = mod.replaceOne(text, query, replacement, index);
        if (!result.replaced) return { count: result.matches.length, index: result.index, replaced: false };
        const target = result.matches[result.index];
        applyEdit(
          {
            text: result.text,
            anchor: target ? target.from : Math.min(text.length, result.text.length),
            head: target ? target.to : Math.min(text.length, result.text.length),
          },
          false,
        );
        return { count: result.matches.length, index: result.index, replaced: true };
      },
      replaceAll(query, replacement) {
        const view = viewRef.current;
        const mod = search.current;
        if (!view || !mod) return { count: 0, replaced: 0 };
        const text = view.state.doc.toString();
        const result = mod.replaceEvery(text, query, replacement);
        if (result.count === 0) return { count: 0, replaced: 0 };
        const target = result.matches[0];
        applyEdit(
          { text: result.text, anchor: target ? target.from : 0, head: target ? target.to : 0 },
          false,
        );
        return { count: result.matches.length, replaced: result.count };
      },
    }),
    [],
  );

  useEffect(() => {
    if (lineEnding === expectedLineEnding.current) return;
    // The document itself changed its ending (load, discard, save from another
    // state): a conversion recorded against the old document is meaningless.
    lineUndo.current = null;
    lineRedo.current = null;
    expectedLineEnding.current = lineEnding;
  }, [lineEnding]);

  useEffect(() => {
    const view = viewRef.current;
    const effect = focusEffectRef.current;
    if (view && effect) view.dispatch({ effects: effect(focusMode) });
  }, [focusMode]);

  useEffect(() => {
    if (typewriter) scrollTypewriterRef.current?.();
  }, [typewriter]);

  // M6-4 EDIT-21: lazy-load the dictionary the first time the setting turns on;
  // a failed load just leaves the checker off rather than blocking the editor.
  useEffect(() => {
    if (!spellCheck) return;
    let alive = true;
    void spellCheckModule.current?.loadDictionary().then((checker) => {
      if (!alive || !checker) return;
      spellChecker.current = checker;
      const view = viewRef.current;
      if (view) scheduleScanRef.current?.(view, 0);
    });
    return () => {
      alive = false;
    };
  }, [spellCheck]);

  useEffect(() => {
    if (spellCheck) return;
    closeSpellMenuRef.current();
    // Clearing the marks needs an explicit field re-init: the field's update
    // only maps decorations on transactions, so toggling off would leave stale
    // underlines until the next keystroke without it (M6-4 EDIT-21).
    const view = viewRef.current;
    if (view) clearSpellMarksRef.current?.(view);
  }, [spellCheck]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [
        { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, Decoration, ViewPlugin },
        { EditorState, StateEffect, StateField, RangeSetBuilder },
        { defaultKeymap, history, historyKeymap, undo, redo, isolateHistory: isolateHistoryType },
        { markdown },
        paragraphModule,
        inlineModule,
        searchModule,
        lineopsModule,
        assistModule,
        mathModule,
        codeToolsModule,
        smartPunctModule,
        spellCheckModuleResult,
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/commands"),
        import("@codemirror/lang-markdown"),
        import("../editor/paragraph"),
        import("../editor/inline"),
        import("../editor/search"),
        import("../editor/lineops"),
        import("../editor/editassist"),
        import("../editor/mathtools"),
        import("../editor/codetools"),
        import("../editor/smartpunct"),
        import("../editor/spellcheck"),
      ]);
      if (!alive || !host.current) return;
      historyActions.current = { undo, redo };
      isolateHistory.current = isolateHistoryType;
      paragraph.current = paragraphModule;
      inline.current = inlineModule;
      search.current = searchModule;
      lineops.current = lineopsModule;
      assist.current = assistModule;
      mathTools.current = mathModule;
      codeTools.current = codeToolsModule;
      smartPunct.current = smartPunctModule;
      spellCheckModule.current = spellCheckModuleResult;
      stateCtor.current = EditorState;

      const theme = EditorView.theme({
        "&": {
          height: "100%",
          backgroundColor: "var(--bg-app)",
          color: "var(--text)",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--read-size)",
          lineHeight: "1.75",
        },
        ".cm-content": {
          maxWidth: "calc(var(--content-max) + var(--content-pad-x) * 2)",
          margin: "0 auto",
          padding: "var(--content-pad-top) var(--content-pad-x) 40vh",
          caretColor: "var(--accent)",
        },
        ".cm-gutters": {
          backgroundColor: "var(--bg-chrome)",
          color: "var(--text-faint)",
          borderRight: "1px solid var(--line)",
        },
        ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "var(--bg-active)",
        },
        ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)" },
        ".cm-cursor": { borderLeftColor: "var(--accent)" },
        ".cm-line": { transition: "opacity var(--dur-base) var(--ease)" },
        ".cm-focus-dim": { opacity: "0.32" },
        "&.cm-focused": { outline: "none" },
      });

      const focusEffect = StateEffect.define<boolean>();
      focusEffectRef.current = (value) => focusEffect.of(value);
      const focusField = StateField.define<boolean>({
        create: () => focusModeRef.current,
        update(value, transaction) {
          let next = value;
          for (const effect of transaction.effects) {
            if (effect.is(focusEffect)) next = effect.value;
          }
          return next;
        },
      });
      const buildFocusDecorations = (view: EditorView) => {
        if (!view.state.field(focusField)) return Decoration.none;
        const doc = view.state.doc;
        const head = view.state.selection.main.head;
        const current = doc.lineAt(head).number;
        let first = current;
        let last = current;
        if (doc.line(current).text.trim() !== "") {
          while (first > 1 && doc.line(first - 1).text.trim() !== "") first--;
          while (last < doc.lines && doc.line(last + 1).text.trim() !== "") last++;
        }
        const builder = new RangeSetBuilder<DecorationType>();
        for (const range of view.visibleRanges) {
          const from = doc.lineAt(range.from).number;
          const to = doc.lineAt(range.to).number;
          for (let number = from; number <= to; number++) {
            if (number >= first && number <= last) continue;
            const line = doc.line(number);
            builder.add(line.from, line.from, Decoration.line({ class: "cm-focus-dim" }));
          }
        }
        return builder.finish();
      };
      const focusPlugin = ViewPlugin.fromClass(
        class {
          decorations = Decoration.none;
          constructor(view: EditorView) {
            this.decorations = buildFocusDecorations(view);
          }
          update(update: import("@codemirror/view").ViewUpdate) {
            if (
              update.docChanged ||
              update.selectionSet ||
              update.viewportChanged ||
              update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(focusEffect)))
            ) {
              this.decorations = buildFocusDecorations(update.view);
            }
          }
        },
        { decorations: (value) => value.decorations },
      );

      const scrollTypewriter = () => {
        const view = viewRef.current;
        if (!view || !typewriterRef.current) return;
        const block = view.lineBlockAt(view.state.selection.main.head);
        const scroller = view.scrollDOM;
        scroller.scrollTop = Math.max(0, block.top - scroller.clientHeight * 0.4);
      };
      scrollTypewriterRef.current = scrollTypewriter;

      // M6-4 EDIT-21: spell-check helpers shared by the field, the plugin and
      // the context-menu handler. Live handles are published through the
      // component-level refs so the enable/disable effects can reach them.
      const spellMenuEl = { current: null as HTMLDivElement | null };
      const closeSpellMenu = () => {
        spellMenuEl.current?.remove();
        spellMenuEl.current = null;
        spellMenu.current = null;
      };
      closeSpellMenuRef.current = closeSpellMenu;
      const buildSpellDecorations = (view: EditorView): DecorationSet => {
        const mod = spellCheckModule.current;
        const checker = spellChecker.current;
        if (!mod || !checker) return Decoration.none;
        const errors: import("../editor/spellcheck").SpellError[] = [];
        for (const range of view.visibleRanges) {
          errors.push(...mod.scanRange(view.state.doc.toString(), range.from, range.to, checker));
        }
        const builder = new RangeSetBuilder<DecorationType>();
        for (const error of errors) builder.add(error.from, error.to, Decoration.mark({ class: "cm-spell-error" }));
        return builder.finish();
      };
      const scheduleScan = (view: EditorView, delay = 400) => {
        if (!spellCheckRef.current || !spellChecker.current) return;
        if (spellScanTimer.current !== null) window.clearTimeout(spellScanTimer.current);
        spellScanTimer.current = window.setTimeout(() => {
          spellScanTimer.current = null;
          if (!spellCheckRef.current || !spellChecker.current || !spellFieldRef.current) return;
          const decorations = buildSpellDecorations(view);
          view.dispatch({ effects: StateEffect.appendConfig.of([spellFieldRef.current.init(() => decorations)]) });
        }, delay);
      };
      scheduleScanRef.current = scheduleScan;
      clearSpellMarksRef.current = (view: EditorView) => {
        const field = spellFieldRef.current;
        if (field) view.dispatch({ effects: StateEffect.appendConfig.of([field.init(() => Decoration.none)]) });
      };
      const openSpellMenu = (view: EditorView, error: import("../editor/spellcheck").SpellError) => {
        closeSpellMenu();
        const mod = spellCheckModule.current;
        const checker = spellChecker.current;
        if (!mod || !checker) return;
        const suggestions = mod.suggestions(checker, error.word, 5);
        spellMenu.current = { open: true, word: error.word, suggestions };
        const el = document.createElement("div");
        el.className = "cm-spell-menu";
        el.setAttribute("role", "menu");
        const rect = view.coordsAtPos(error.from);
        if (rect) {
          el.style.left = `${rect.left}px`;
          el.style.top = `${rect.bottom + 4}px`;
        } else {
          const caret = view.coordsAtPos(view.state.selection.main.head);
          el.style.left = caret ? `${caret.left}px` : "0";
          el.style.top = caret ? `${caret.bottom + 4}px` : "0";
        }
        const dismiss = () => closeSpellMenu();
        for (const suggestion of suggestions) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cm-spell-menu-item";
          btn.setAttribute("role", "menuitem");
          btn.textContent = suggestion;
          btn.addEventListener("click", () => {
            view.dispatch({
              changes: { from: error.from, to: error.to, insert: suggestion },
              selection: { anchor: error.from + suggestion.length },
              scrollIntoView: true,
            });
            closeSpellMenu();
            view.focus();
          });
          el.appendChild(btn);
        }
        const ignore = document.createElement("button");
        ignore.type = "button";
        ignore.className = "cm-spell-menu-item cm-spell-menu-ignore";
        ignore.setAttribute("role", "menuitem");
        ignore.textContent = "忽略本次";
        ignore.addEventListener("click", () => {
          mod.ignoreForSession(error.word);
          closeSpellMenu();
          scheduleScan(view, 0);
        });
        el.appendChild(ignore);
        el.addEventListener("pointerdown", (event) => event.stopPropagation());
        document.body.appendChild(el);
        spellMenuEl.current = el;
        const onDocClick = (event: PointerEvent) => {
          if (spellMenuEl.current && !spellMenuEl.current.contains(event.target as Node)) dismiss();
        };
        document.addEventListener("pointerdown", onDocClick, true);
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "Escape") dismiss();
        };
        document.addEventListener("keydown", onKey, true);
        const removeListeners = () => {
          document.removeEventListener("pointerdown", onDocClick, true);
          document.removeEventListener("keydown", onKey, true);
        };
        el.addEventListener("remove", removeListeners, { once: true });
      };

      const mathContextAt = (text: string, position: number) => {
        const mod = mathTools.current;
        if (!mod) return { inMath: false, blocked: false };
        return {
          inMath: mod.mathAt({ text, anchor: position, head: position }) !== null,
          blocked: mod.mathProtected(text, position),
        };
      };
      /** codeContextAt reports fenced-code state for the code-tools submenu. */
      const codeContextAt = (text: string, anchor: number, head: number) => {
        const mod = codeTools.current;
        if (!mod) return { inFence: false, fenceLanguage: "", crossFence: false };
        const target = mod.fenceAt({ text, anchor, head });
        if (!target) return { inFence: false, fenceLanguage: "", crossFence: false };
        if (target.kind === "cross") return { inFence: false, fenceLanguage: "", crossFence: true };
        return { inFence: true, fenceLanguage: target.fence.language, crossFence: false };
      };
      const editorExtensions: Extension[] = [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        focusField,
        focusPlugin,
        EditorView.lineWrapping,
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-z",
            run: () => {
              const conversion = lineUndo.current;
              if (!conversion) return false;
              lineUndo.current = null;
              lineRedo.current = conversion;
              expectedLineEnding.current = conversion.from;
              onLineEndingChangeRef.current?.(conversion.from);
              return true;
            },
          },
          {
            key: "Mod-y",
            run: () => {
              const conversion = lineRedo.current;
              if (!conversion) return false;
              lineRedo.current = null;
              lineUndo.current = conversion;
              expectedLineEnding.current = conversion.to;
              onLineEndingChangeRef.current?.(conversion.to);
              return true;
            },
          },
          {
            key: "Mod-Shift-z",
            run: () => {
              const conversion = lineRedo.current;
              if (!conversion) return false;
              lineRedo.current = null;
              lineUndo.current = conversion;
              expectedLineEnding.current = conversion.to;
              onLineEndingChangeRef.current?.(conversion.to);
              return true;
            },
          },
          ...defaultKeymap.filter((binding) => binding.key !== "Mod-/"),
          ...historyKeymap,
        ]),
        markdown(),
        // M6-3 EDIT-18: smart punctuation intercepts one typed character and
        // folds the conversion into the keystroke's own transaction, so one
        // Ctrl+Z undoes the input. IME composition and multi-character input
        // (paste, spellcheck replacement) pass through untouched.
        EditorView.inputHandler.of((view, from, to, text) => {
          if (!smartPunctuationRef.current || view.composing) return false;
          const mod = smartPunct.current;
          if (!mod || text.length !== 1) return false;
          const edit = mod.smartPunct(view.state.doc.toString(), from, to, text);
          if (!edit) return false;
          view.dispatch({
            changes: { from: edit.from, to: edit.to, insert: edit.insert },
            selection: { anchor: edit.from + edit.insert.length },
            scrollIntoView: true,
          });
          return true;
        }),
        // M6-4 EDIT-21: self-drawn spell check. A ViewPlugin scans the visible
        // viewport 400 ms after the last change, draws wavy underlines via
        // Decoration.mark, and shows a right-click suggestion menu only when the
        // caret lands on a misspelled word. The checker is lazy-loaded on first
        // enable; the WebView2 native checker is disabled so the two never fight.
        (() => {
          const field = StateField.define<DecorationSet>({
            create: () => Decoration.none,
            update: (deco, transaction) => {
              if (!spellCheckRef.current || !spellChecker.current) return Decoration.none;
              return deco.map(transaction.changes);
            },
            provide: (f) => EditorView.decorations.from(f),
          });
          spellFieldRef.current = field;
          const plugin = ViewPlugin.fromClass(
            class {
              constructor(view: EditorView) {
                if (spellCheckRef.current) scheduleScan(view, 0);
              }
              update(update: import("@codemirror/view").ViewUpdate) {
                if (!spellCheckRef.current) return;
                if (update.docChanged || update.viewportChanged) scheduleScan(update.view);
              }
            },
          );
          const contextMenu = EditorView.domEventHandlers({
            contextmenu(event, view) {
              if (!spellCheckRef.current || !spellChecker.current || !spellCheckModule.current) return;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return;
              const error = spellCheckModule.current.wordAt(view.state.doc.toString(), pos);
              if (!error || spellCheckModule.current.checkWord(spellChecker.current, error.word)) return;
              event.preventDefault();
              openSpellMenu(view, error);
            },
          });
          return [field, plugin, contextMenu];
        })(),
        theme,
        EditorView.contentAttributes.of({ "aria-label": "Markdown 源码", spellcheck: "false" }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.selectionSet) return;
          // Typing after a conversion makes that conversion no longer the
          // latest action; Ctrl+Z must undo the text first (M5-8 EDIT-19).
          if (update.docChanged) {
            lineUndo.current = null;
            lineRedo.current = null;
          }
          if (update.docChanged && !applying.current) changeRef.current(update.state.doc.toString());
          const text = update.state.doc.toString();
          const range = update.state.selection.main;
          const head = range.head;
          const math = mathContextAt(text, head);
          const code = codeContextAt(text, range.anchor, range.head);
          contextRef.current?.(contextAt(
            text,
            head,
            !range.empty,
            update.view.hasFocus,
            math.inMath,
            math.blocked,
            code.inFence,
            code.fenceLanguage,
            code.crossFence,
          ));
          if (typewriterRef.current) scrollTypewriter();
        }),
      ];
      extensions.current = editorExtensions;
      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({ doc: valueRef.current, extensions: editorExtensions }),
      });
      viewRef.current = view;
      if (typewriterRef.current) scrollTypewriter();
      view.focus();
      const initialMath = mathContextAt(valueRef.current, 0);
      const initialCode = codeContextAt(valueRef.current, 0, 0);
      contextRef.current?.(contextAt(valueRef.current, 0, false, view.hasFocus, initialMath.inMath, initialMath.blocked, initialCode.inFence, initialCode.fenceLanguage, initialCode.crossFence));
      const reportFocus = (focused: boolean) => {
        if (!alive || viewRef.current !== view) return;
        const range = view.state.selection.main;
        const text = view.state.doc.toString();
        const math = mathContextAt(text, range.head);
        const code = codeContextAt(text, range.anchor, range.head);
        contextRef.current?.(contextAt(text, range.head, !range.empty, focused, math.inMath, math.blocked, code.inFence, code.fenceLanguage, code.crossFence));
      };
      const onFocus = () => reportFocus(true);
      const onBlur = (event: FocusEvent) => {
        // Opening a menu or using a toolbar button must not disable commands
        // that need the editor's focus; the command itself returns focus.
        const next = event.relatedTarget as HTMLElement | null;
        if (next && typeof next.closest === "function" && next.closest(".menubar, .toolbar")) return;
        reportFocus(false);
      };
      view.dom.addEventListener("focus", onFocus, true);
      view.dom.addEventListener("blur", onBlur, true);
      viewCleanup.current = () => {
        closeSpellMenu();
        if (spellScanTimer.current !== null) window.clearTimeout(spellScanTimer.current);
        spellScanTimer.current = null;
        view.dom.removeEventListener("focus", onFocus, true);
        view.dom.removeEventListener("blur", onBlur, true);
      };
    })();

    return () => {
      alive = false;
      viewCleanup.current?.();
      viewCleanup.current = null;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  // A different buffer (another document, a reload or a discard) resets the
  // editor state and its undo history: Ctrl+Z must never reach the previous
  // document or resurrect text the user chose to discard.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !stateCtor.current || !extensions.current) return;
    if (view.state.doc.toString() === value) return;
    lineUndo.current = null;
    lineRedo.current = null;
    const previous = view.state.selection.main;
    const scrollTop = view.scrollDOM.scrollTop;
    const hadFocus = view.hasFocus;
    applying.current = true;
    view.setState(stateCtor.current.create({ doc: value, extensions: extensions.current }));
    applying.current = false;
    const anchor = Math.min(previous.anchor, value.length);
    const head = Math.min(previous.head, value.length);
    view.dispatch({ selection: { anchor, head } });
    if (!typewriterRef.current) view.scrollDOM.scrollTop = scrollTop;
    if (hadFocus) view.focus();
  }, [value]);

  return <div className="source-editor" ref={host} />;
}

/** selectedText is the main selection's source text, or "". */
function selectedText(view: EditorView): string {
  const range = view.state.selection.main;
  if (range.empty) return "";
  return view.state.sliceDoc(range.from, range.to);
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/** contextAt reports what the caret touches, for menu enablement (M5-4). */
export function contextAt(
  text: string,
  position: number,
  hasSelection = false,
  focused = false,
  inMath = false,
  mathBlocked = false,
  inFence = false,
  fenceLanguage = "",
  crossFence = false,
): EditorContext {
  const snapshot = { text, anchor: position, head: position };
  return {
    inTable: inTableAt(text, position),
    inLink: linkAt(snapshot) !== null,
    inImage: imageAt(snapshot) !== null,
    hasSelection,
    focused,
    inMath,
    mathBlocked,
    inFence,
    fenceLanguage,
    crossFence,
  };
}

/** inTableAt is a cheap local check for menu enablement, not a full parse. */
export function inTableAt(text: string, position: number): boolean {  let lineStart = text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const lineEnd = text.indexOf("\n", position);
  const current = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  if (!TABLE_ROW.test(current)) return false;
  while (lineStart > 0) {
    const previousEnd = lineStart - 1;
    const previousStart = text.lastIndexOf("\n", previousEnd - 1) + 1;
    if (!TABLE_ROW.test(text.slice(previousStart, previousEnd))) break;
    lineStart = previousStart;
  }
  const firstEnd = text.indexOf("\n", lineStart);
  const secondStart = firstEnd === -1 ? text.length : firstEnd + 1;
  const secondEnd = text.indexOf("\n", secondStart);
  const second = text.slice(secondStart, secondEnd === -1 ? text.length : secondEnd);
  return TABLE_DELIMITER.test(second);
}
