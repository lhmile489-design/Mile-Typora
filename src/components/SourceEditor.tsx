import { useEffect, useImperativeHandle, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import type { AnnotationType, Extension } from "@codemirror/state";
import type { HeadingLevel, ParagraphEdit, Snapshot } from "../editor/paragraph";

type ParagraphModule = typeof import("../editor/paragraph");
type InlineModule = typeof import("../editor/inline");
type SearchModule = typeof import("../editor/search");
type LineOpsModule = typeof import("../editor/lineops");

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
  ref?: React.Ref<SourceCommands>;
};

/**
 * The Markdown source editor (PRD 10.1, M4-1). CodeMirror is imported only
 * when editing starts, so reading pays nothing for it. The buffer is the
 * editor's document; preview renders the same string through Go.
 */
export function SourceEditor({ value, onChange, readClipboard, writeClipboard, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
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
  const isolateHistory = useRef<AnnotationType<"after" | "before" | "full"> | null>(null);
  const stateCtor = useRef<typeof import("@codemirror/state").EditorState | null>(null);
  const extensions = useRef<Extension[] | null>(null);

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

  useImperativeHandle(
    ref,
    (): SourceCommands => ({
      focus() {
        viewRef.current?.focus();
      },
      undo() {
        const view = viewRef.current;
        if (!view || !historyActions.current) return;
        historyActions.current.undo(view);
        view.focus();
      },
      redo() {
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
    let alive = true;
    void (async () => {
      const [
        { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine },
        { EditorState },
        { defaultKeymap, history, historyKeymap, undo, redo, isolateHistory: isolateHistoryType },
        { markdown },
        paragraphModule,
        inlineModule,
        searchModule,
        lineopsModule,
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/commands"),
        import("@codemirror/lang-markdown"),
        import("../editor/paragraph"),
        import("../editor/inline"),
        import("../editor/search"),
        import("../editor/lineops"),
      ]);
      if (!alive || !host.current) return;
      historyActions.current = { undo, redo };
      isolateHistory.current = isolateHistoryType;
      paragraph.current = paragraphModule;
      inline.current = inlineModule;
      search.current = searchModule;
      lineops.current = lineopsModule;
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
        "&.cm-focused": { outline: "none" },
      });

      const editorExtensions: Extension[] = [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap.filter((binding) => binding.key !== "Mod-/"), ...historyKeymap]),
        markdown(),
        theme,
        EditorView.contentAttributes.of({ "aria-label": "Markdown 源码" }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applying.current) return;
          changeRef.current(update.state.doc.toString());
        }),
      ];
      extensions.current = editorExtensions;
      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({ doc: valueRef.current, extensions: editorExtensions }),
      });
      viewRef.current = view;
      view.focus();
    })();

    return () => {
      alive = false;
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
    const previous = view.state.selection.main;
    const scrollTop = view.scrollDOM.scrollTop;
    const hadFocus = view.hasFocus;
    applying.current = true;
    view.setState(stateCtor.current.create({ doc: value, extensions: extensions.current }));
    applying.current = false;
    const anchor = Math.min(previous.anchor, value.length);
    const head = Math.min(previous.head, value.length);
    view.dispatch({ selection: { anchor, head } });
    view.scrollDOM.scrollTop = scrollTop;
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
