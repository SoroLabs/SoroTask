"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import CodeBlock from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import type { TaskContent } from "@/src/types/task";

interface RichTextEditorProps {
  initialContent?: TaskContent | null;
  placeholder?: string;
  onChange?: (content: TaskContent) => void;
  "data-testid"?: string;
}

const EXTENSIONS = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlock,
  Link.configure({ openOnClick: false, autolink: true }),
  Placeholder.configure({ placeholder: "Add a description…" }),
];

export default function RichTextEditor({
  initialContent,
  placeholder,
  onChange,
  "data-testid": testId,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: placeholder
      ? [
          StarterKit.configure({ codeBlock: false }),
          CodeBlock,
          Link.configure({ openOnClick: false, autolink: true }),
          Placeholder.configure({ placeholder }),
        ]
      : EXTENSIONS,
    content: initialContent ?? undefined,
    onUpdate({ editor }) {
      onChange?.(editor.getJSON() as TaskContent);
    },
    immediatelyRender: false,
  });

  if (!editor) return null;

  return (
    <div
      className="rich-text-editor rounded-lg border border-neutral-700/50 bg-neutral-900 text-neutral-100"
      data-testid={testId}
    >
      {/* Toolbar */}
      <div
        className="flex flex-wrap gap-1 border-b border-neutral-700/50 p-2"
        role="toolbar"
        aria-label="Text formatting"
      >
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          aria-label="Bold"
          title="Bold"
        >
          <strong>B</strong>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          aria-label="Italic"
          title="Italic"
        >
          <em>I</em>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          aria-label="Strikethrough"
          title="Strikethrough"
        >
          <s>S</s>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          aria-label="Inline code"
          title="Inline code"
        >
          {"<>"}
        </ToolbarButton>

        <div className="mx-1 w-px bg-neutral-700" aria-hidden />

        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          isActive={editor.isActive("heading", { level: 1 })}
          aria-label="Heading 1"
          title="Heading 1"
        >
          H1
        </ToolbarButton>

        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          isActive={editor.isActive("heading", { level: 2 })}
          aria-label="Heading 2"
          title="Heading 2"
        >
          H2
        </ToolbarButton>

        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          isActive={editor.isActive("heading", { level: 3 })}
          aria-label="Heading 3"
          title="Heading 3"
        >
          H3
        </ToolbarButton>

        <div className="mx-1 w-px bg-neutral-700" aria-hidden />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          aria-label="Bullet list"
          title="Bullet list"
        >
          •—
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          aria-label="Ordered list"
          title="Ordered list"
        >
          1.
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          aria-label="Blockquote"
          title="Blockquote"
        >
          "
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive("codeBlock")}
          aria-label="Code block"
          title="Code block"
        >
          {"{ }"}
        </ToolbarButton>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="prose prose-invert max-w-none p-4 focus:outline-none min-h-[120px]"
      />
    </div>
  );
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive: boolean;
  children: React.ReactNode;
  "aria-label": string;
  title: string;
}

function ToolbarButton({
  onClick,
  isActive,
  children,
  "aria-label": ariaLabel,
  title,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      title={title}
      className={`rounded px-2 py-1 text-sm font-medium transition-colors ${
        isActive
          ? "bg-blue-600 text-white"
          : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}
