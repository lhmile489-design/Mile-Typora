import { useEffect, useImperativeHandle, useRef } from "react";
import type { EditorView } from "@codemirror/view";

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
    }),
    [],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine }, { EditorState }, { defaultKeymap, history, historyKeymap, undo, redo }, { markdown }] =
        await Promise.all([
          import("@codemirror/view"),
          import("@codemirror/state"),
          import("@codemirror/commands"),
          import("@codemirror/lang-markdown"),
        ]);
      if (!alive || !host.current) return;
      historyActions.current = { undo, redo };

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

      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: valueRef.current,
          extensions: [
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
          ],
        }),
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

  // A different buffer (another document) replaces the editor's content
  // without pretending the user typed it.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    applying.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    applying.current = false;
  }, [value]);

  return <div className="source-editor" ref={host} />;
}

/** selectedText is the main selection's source text, or "". */
function selectedText(view: EditorView): string {
  const range = view.state.selection.main;
  if (range.empty) return "";
  return view.state.sliceDoc(range.from, range.to);
}
