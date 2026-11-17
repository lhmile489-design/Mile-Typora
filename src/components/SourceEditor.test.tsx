import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SourceEditor, type SourceCommands } from "./SourceEditor";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState("A");
  const editor = useRef<SourceCommands>(null);
  return (
    <>
      <button type="button" onClick={() => editor.current?.setHeading(1)}>
        标题
      </button>
      <button type="button" onClick={() => setValue("B")}>
        换文档
      </button>
      <SourceEditor
        ref={editor}
        value={value}
        onChange={setValue}
        readClipboard={async () => ""}
        writeClipboard={async () => true}
      />
    </>
  );
}

describe("source editor view modes", () => {
  it("dims paragraphs outside the caret when focus mode is on", async () => {
    render(
      <SourceEditor
        value={"第一段\n\n第二段"}
        onChange={() => {}}
        readClipboard={async () => ""}
        writeClipboard={async () => true}
        focusMode
      />,
    );
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();
    await waitFor(() => expect(content.querySelectorAll(".cm-focus-dim").length).toBeGreaterThan(0));
  });
});

describe("source editor buffers", () => {
  it("does not let undo cross a document replacement", async () => {
    render(<Harness />);
    const content = await screen.findByLabelText("Markdown 源码", {}, { timeout: 3000 });
    content.focus();

    fireEvent.click(screen.getByRole("button", { name: "标题" }));
    await waitFor(() => expect(content.textContent).toContain("# A"));

    fireEvent.click(screen.getByRole("button", { name: "换文档" }));
    await waitFor(() => expect(content.textContent).toContain("B"));
    expect(content.textContent).not.toContain("# A");

    content.focus();
    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    await waitFor(() => expect(content.textContent).toContain("B"));
    expect(content.textContent).not.toContain("# A");
  });
});
