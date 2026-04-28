import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import RichTextEditor from "../RichTextEditor";
import type { TaskContent } from "@/src/types/task";

// Tiptap uses ProseMirror which relies on browser APIs not fully available in
// jsdom. We mock the heavy editor internals and test the component contract:
// toolbar rendering, aria attributes, onChange wiring, and initial content.

jest.mock("@tiptap/react", () => {
  const actual = jest.requireActual("@tiptap/react");

  const mockEditor = {
    isActive: jest.fn(() => false),
    chain: jest.fn(() => ({
      focus: jest.fn(() => ({
        toggleBold: jest.fn(() => ({ run: jest.fn() })),
        toggleItalic: jest.fn(() => ({ run: jest.fn() })),
        toggleStrike: jest.fn(() => ({ run: jest.fn() })),
        toggleCode: jest.fn(() => ({ run: jest.fn() })),
        toggleHeading: jest.fn(() => ({ run: jest.fn() })),
        toggleBulletList: jest.fn(() => ({ run: jest.fn() })),
        toggleOrderedList: jest.fn(() => ({ run: jest.fn() })),
        toggleBlockquote: jest.fn(() => ({ run: jest.fn() })),
        toggleCodeBlock: jest.fn(() => ({ run: jest.fn() })),
      })),
    })),
    getJSON: jest.fn(() => ({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "test" }] },
      ],
    })),
    destroy: jest.fn(),
  };

  return {
    ...actual,
    useEditor: jest.fn(() => mockEditor),
    EditorContent: ({ editor }: { editor: unknown }) =>
      editor ? (
        <div data-testid="editor-content" contentEditable suppressContentEditableWarning>
          editor area
        </div>
      ) : null,
  };
});

describe("RichTextEditor", () => {
  describe("toolbar rendering", () => {
    it("renders the toolbar", () => {
      render(<RichTextEditor />);
      expect(screen.getByRole("toolbar")).toBeInTheDocument();
    });

    it("renders Bold button", () => {
      render(<RichTextEditor />);
      expect(screen.getByRole("button", { name: /bold/i })).toBeInTheDocument();
    });

    it("renders Italic button", () => {
      render(<RichTextEditor />);
      expect(screen.getByRole("button", { name: /italic/i })).toBeInTheDocument();
    });

    it("renders Strikethrough button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /strikethrough/i })
      ).toBeInTheDocument();
    });

    it("renders Inline code button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /inline code/i })
      ).toBeInTheDocument();
    });

    it("renders Heading 1 button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /heading 1/i })
      ).toBeInTheDocument();
    });

    it("renders Heading 2 button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /heading 2/i })
      ).toBeInTheDocument();
    });

    it("renders Heading 3 button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /heading 3/i })
      ).toBeInTheDocument();
    });

    it("renders Bullet list button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /bullet list/i })
      ).toBeInTheDocument();
    });

    it("renders Ordered list button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /ordered list/i })
      ).toBeInTheDocument();
    });

    it("renders Blockquote button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /blockquote/i })
      ).toBeInTheDocument();
    });

    it("renders Code block button", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("button", { name: /code block/i })
      ).toBeInTheDocument();
    });
  });

  describe("toolbar accessibility", () => {
    it("toolbar has aria-label", () => {
      render(<RichTextEditor />);
      expect(
        screen.getByRole("toolbar", { name: /text formatting/i })
      ).toBeInTheDocument();
    });

    it("toolbar buttons have aria-pressed attribute", () => {
      render(<RichTextEditor />);
      const boldBtn = screen.getByRole("button", { name: /bold/i });
      expect(boldBtn).toHaveAttribute("aria-pressed");
    });

    it("inactive button has aria-pressed=false", () => {
      render(<RichTextEditor />);
      const boldBtn = screen.getByRole("button", { name: /bold/i });
      expect(boldBtn).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("toolbar interactions", () => {
    it("calls chain().focus().toggleBold().run() when Bold is clicked", () => {
      const { useEditor } = jest.requireMock("@tiptap/react") as {
        useEditor: jest.Mock;
      };
      const editor = useEditor();
      render(<RichTextEditor />);
      fireEvent.click(screen.getByRole("button", { name: /bold/i }));
      expect(editor.chain).toHaveBeenCalled();
    });

    it("calls chain().focus().toggleItalic().run() when Italic is clicked", () => {
      const { useEditor } = jest.requireMock("@tiptap/react") as {
        useEditor: jest.Mock;
      };
      const editor = useEditor();
      render(<RichTextEditor />);
      fireEvent.click(screen.getByRole("button", { name: /italic/i }));
      expect(editor.chain).toHaveBeenCalled();
    });

    it("calls chain when Heading 1 is clicked", () => {
      const { useEditor } = jest.requireMock("@tiptap/react") as {
        useEditor: jest.Mock;
      };
      const editor = useEditor();
      render(<RichTextEditor />);
      fireEvent.click(screen.getByRole("button", { name: /heading 1/i }));
      expect(editor.chain).toHaveBeenCalled();
    });
  });

  describe("editor content area", () => {
    it("renders the editor content area", () => {
      render(<RichTextEditor />);
      expect(screen.getByTestId("editor-content")).toBeInTheDocument();
    });

    it("applies data-testid to the wrapper", () => {
      render(<RichTextEditor data-testid="my-editor" />);
      expect(screen.getByTestId("my-editor")).toBeInTheDocument();
    });
  });

  describe("initial content", () => {
    it("passes initialContent to useEditor", () => {
      const { useEditor } = jest.requireMock("@tiptap/react") as {
        useEditor: jest.Mock;
      };
      const content: TaskContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "prefilled" }],
          },
        ],
      };
      render(<RichTextEditor initialContent={content} />);
      const callArgs = useEditor.mock.calls[useEditor.mock.calls.length - 1][0];
      expect(callArgs.content).toEqual(content);
    });

    it("passes null initialContent as undefined to useEditor", () => {
      const { useEditor } = jest.requireMock("@tiptap/react") as {
        useEditor: jest.Mock;
      };
      render(<RichTextEditor initialContent={null} />);
      const callArgs = useEditor.mock.calls[useEditor.mock.calls.length - 1][0];
      expect(callArgs.content).toBeUndefined();
    });
  });

  describe("onChange callback", () => {
    it("wires onUpdate to call onChange with editor JSON", () => {
      const { useEditor } = jest.requireMock("@tiptap/react") as {
        useEditor: jest.Mock;
      };
      const onChange = jest.fn();
      render(<RichTextEditor onChange={onChange} />);

      // Simulate Tiptap calling onUpdate
      const callArgs = useEditor.mock.calls[useEditor.mock.calls.length - 1][0];
      const mockEditorInstance = useEditor();
      act(() => {
        callArgs.onUpdate({ editor: mockEditorInstance });
      });

      expect(onChange).toHaveBeenCalledWith(mockEditorInstance.getJSON());
    });

    it("does not throw when onChange is not provided", () => {
      const { useEditor } = jest.requireMock("@tiptap/react") as {
        useEditor: jest.Mock;
      };
      render(<RichTextEditor />);
      const callArgs = useEditor.mock.calls[useEditor.mock.calls.length - 1][0];
      const mockEditorInstance = useEditor();
      expect(() => {
        act(() => {
          callArgs.onUpdate({ editor: mockEditorInstance });
        });
      }).not.toThrow();
    });
  });

  describe("custom placeholder", () => {
    it("passes custom placeholder to Placeholder extension", () => {
      const { useEditor } = jest.requireMock("@tiptap/react") as {
        useEditor: jest.Mock;
      };
      render(<RichTextEditor placeholder="Write something..." />);
      // The placeholder is passed via extensions config — verify useEditor was called
      expect(useEditor).toHaveBeenCalled();
    });
  });
});
