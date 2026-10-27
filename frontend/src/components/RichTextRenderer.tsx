"use client";

import { generateHTML } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import CodeBlock from "@tiptap/extension-code-block";
import { sanitizeHtml, addSafeLinkAttributes } from "@/src/lib/sanitize";
import type { TaskContent } from "@/src/types/task";

interface RichTextRendererProps {
  content: TaskContent;
  className?: string;
  "data-testid"?: string;
}

const RENDER_EXTENSIONS = [
  // StarterKit v3 bundles Link/CodeBlock; disable both so the explicitly
  // configured extensions below are the single source of truth.
  StarterKit.configure({ codeBlock: false, link: false }),
  CodeBlock,
  Link.configure({ openOnClick: false }),
];

/**
 * Secure read-only renderer for Tiptap JSON content.
 *
 * Pipeline:
 *   TaskContent (JSON) → generateHTML (Tiptap) → sanitizeHtml (DOMPurify) → dangerouslySetInnerHTML
 *
 * DOMPurify strips any tags/attributes not in the allowlist, preventing XSS
 * even if malicious content somehow reaches the stored JSON.
 */
export default function RichTextRenderer({
  content,
  className = "",
  "data-testid": testId,
}: RichTextRendererProps) {
  const rawHtml = generateHTML(content, RENDER_EXTENSIONS);
  const safeHtml = addSafeLinkAttributes(sanitizeHtml(rawHtml));

  return (
    <div
      className={`prose prose-invert max-w-none ${className}`}
      data-testid={testId}

      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
