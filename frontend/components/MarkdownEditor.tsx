"use client";

import React, { useState, useCallback, useId } from "react";
import { sanitizeHtml } from "@/src/lib/sanitize";

// ---------------------------------------------------------------------------
// Minimal inline syntax highlighter — no external runtime required.
// Supports: fenced code blocks, inline code, bold, italic, headings, lists,
// blockquotes, and links.  Output is safe (no dangerouslySetInnerHTML with
// raw user HTML — tags are escaped first).
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Very lightweight tokeniser — good enough for task instructions. */
function renderMarkdown(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
      out.push(
        `<pre class="md-code-block"${langAttr}><code>${codeLines.join("\n")}</code></pre>`,
      );
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(
        `<h${level} class="md-h${level}">${inlineRender(headingMatch[2])}</h${level}>`,
      );
      i++;
      continue;
    }

    // Blockquote
    if (/^>/.test(line)) {
      out.push(
        `<blockquote class="md-blockquote">${inlineRender(line.slice(1).trim())}</blockquote>`,
      );
      i++;
      continue;
    }

    // Unordered list item
    if (/^[-*+]\s/.test(line)) {
      out.push(`<li class="md-li">${inlineRender(line.slice(2).trim())}</li>`);
      i++;
      continue;
    }

    // Ordered list item
    if (/^\d+\.\s/.test(line)) {
      out.push(
        `<li class="md-li">${inlineRender(line.replace(/^\d+\.\s/, "").trim())}</li>`,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      out.push('<hr class="md-hr" />');
      i++;
      continue;
    }

    // Empty line → paragraph break
    if (line.trim() === "") {
      out.push('<p class="md-p"></p>');
      i++;
      continue;
    }

    // Paragraph
    out.push(`<p class="md-p">${inlineRender(line)}</p>`);
    i++;
  }

  return out.join("\n");
}

function inlineRender(text: string): string {
  return (
    escapeHtml(text)
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
      // Bold + italic
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Strikethrough
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      // Links
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MarkdownEditorProps {
  /** Initial markdown value */
  value?: string;
  /** Called on every change */
  onChange?: (value: string) => void;
  /** Placeholder text shown in the editor */
  placeholder?: string;
  /** Label for accessibility */
  label?: string;
  /** Minimum textarea height in px */
  minHeight?: number;
}

type Tab = "write" | "preview";

const TOOLBAR_ACTIONS: Array<{
  label: string;
  title: string;
  prefix: string;
  suffix: string;
  multiline?: boolean;
}> = [
  { label: "B", title: "Bold", prefix: "**", suffix: "**" },
  { label: "I", title: "Italic", prefix: "*", suffix: "*" },
  { label: "~~", title: "Strikethrough", prefix: "~~", suffix: "~~" },
  { label: "<>", title: "Inline code", prefix: "`", suffix: "`" },
  {
    label: "```",
    title: "Code block",
    prefix: "```\n",
    suffix: "\n```",
    multiline: true,
  },
  { label: "H1", title: "Heading 1", prefix: "# ", suffix: "" },
  { label: "H2", title: "Heading 2", prefix: "## ", suffix: "" },
  { label: "—", title: "Horizontal rule", prefix: "\n---\n", suffix: "" },
  { label: ">", title: "Blockquote", prefix: "> ", suffix: "" },
  { label: "• ", title: "List item", prefix: "- ", suffix: "" },
];

/**
 * MarkdownEditor
 *
 * A split write/preview markdown editor with a lightweight built-in renderer
 * (no runtime dependencies).  Supports code snippet highlighting via CSS.
 * Drop-in replacement for a plain <textarea> in task instruction fields.
 */
export default function MarkdownEditor({
  value = "",
  onChange,
  placeholder = "Write task instructions using **Markdown**…\n\nTip: wrap code in ```backticks```",
  label = "Task instructions",
  minHeight = 200,
}: MarkdownEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("write");
  const [internalValue, setInternalValue] = useState(value);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const editorId = useId();

  const currentValue = onChange ? value : internalValue;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      if (!onChange) setInternalValue(v);
      onChange?.(v);
    },
    [onChange],
  );

  /** Insert markup around the current selection or at the cursor. */
  const applyToolbarAction = useCallback(
    (prefix: string, suffix: string) => {
      const ta = textareaRef.current;
      if (!ta) return;

      const { selectionStart: start, selectionEnd: end, value: val } = ta;
      const selected = val.slice(start, end);
      const replacement = `${prefix}${selected}${suffix}`;
      const next = val.slice(0, start) + replacement + val.slice(end);

      if (!onChange) setInternalValue(next);
      onChange?.(next);

      // Restore selection inside the newly inserted markup
      requestAnimationFrame(() => {
        ta.focus();
        const cursorPos =
          start + prefix.length + selected.length + suffix.length;
        ta.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [onChange],
  );

  return (
    <div className="md-editor-root" style={{ fontFamily: "inherit" }}>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={`${label} editor tabs`}
        className="md-editor-tabs"
        style={{
          display: "flex",
          borderBottom: "1px solid #3f3f46",
          marginBottom: 0,
        }}
      >
        {(["write", "preview"] as Tab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`${editorId}-panel-${tab}`}
            id={`${editorId}-tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              background: "transparent",
              border: "none",
              borderBottom:
                activeTab === tab
                  ? "2px solid #3b82f6"
                  : "2px solid transparent",
              color: activeTab === tab ? "#e4e4e7" : "#71717a",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}

        {/* Toolbar (only in write mode) */}
        {activeTab === "write" && (
          <div
            style={{
              display: "flex",
              gap: 2,
              marginLeft: "auto",
              alignItems: "center",
              paddingRight: 4,
            }}
          >
            {TOOLBAR_ACTIONS.map((action) => (
              <button
                key={action.title}
                title={action.title}
                type="button"
                onClick={() => applyToolbarAction(action.prefix, action.suffix)}
                style={{
                  padding: "2px 7px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: "#27272a",
                  border: "1px solid #3f3f46",
                  borderRadius: 4,
                  color: "#a1a1aa",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Write panel */}
      <div
        role="tabpanel"
        id={`${editorId}-panel-write`}
        aria-labelledby={`${editorId}-tab-write`}
        hidden={activeTab !== "write"}
      >
        <textarea
          ref={textareaRef}
          id={`${editorId}-textarea`}
          aria-label={label}
          value={currentValue}
          onChange={handleChange}
          placeholder={placeholder}
          spellCheck
          style={{
            width: "100%",
            minHeight,
            padding: "12px",
            background: "#18181b",
            color: "#e4e4e7",
            border: "1px solid #3f3f46",
            borderTop: "none",
            borderRadius: "0 0 6px 6px",
            fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
            fontSize: 13,
            lineHeight: 1.6,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Preview panel */}
      <div
        role="tabpanel"
        id={`${editorId}-panel-preview`}
        aria-labelledby={`${editorId}-tab-preview`}
        hidden={activeTab !== "preview"}
      >
        <div
          className="md-preview"
          style={{
            minHeight,
            padding: "12px",
            background: "#18181b",
            color: "#e4e4e7",
            border: "1px solid #3f3f46",
            borderTop: "none",
            borderRadius: "0 0 6px 6px",
            fontSize: 14,
            lineHeight: 1.7,
            overflowX: "auto",
          }}
          dangerouslySetInnerHTML={{
            __html: currentValue.trim()
              ? sanitizeHtml(renderMarkdown(currentValue))
              : '<p style="color:#71717a">Nothing to preview yet.</p>',
          }}
        />
      </div>

      {/* Embedded styles — scoped via class prefix */}
      <style>{`
        .md-preview .md-h1 { font-size: 1.6em; font-weight: 700; margin: .5em 0 .25em; }
        .md-preview .md-h2 { font-size: 1.3em; font-weight: 700; margin: .5em 0 .25em; }
        .md-preview .md-h3 { font-size: 1.1em; font-weight: 600; margin: .4em 0 .2em; }
        .md-preview .md-h4,.md-preview .md-h5,.md-preview .md-h6 { font-size: 1em; font-weight: 600; margin: .3em 0; }
        .md-preview .md-p { margin: .4em 0; }
        .md-preview .md-blockquote { border-left: 3px solid #3b82f6; padding-left: 12px; color: #a1a1aa; margin: .5em 0; }
        .md-preview .md-hr { border: none; border-top: 1px solid #3f3f46; margin: 1em 0; }
        .md-preview .md-li { list-style: disc; margin-left: 1.5em; }
        .md-preview .md-inline-code {
          background: #27272a;
          color: #f472b6;
          padding: 1px 5px;
          border-radius: 4px;
          font-family: ui-monospace, monospace;
          font-size: .9em;
        }
        .md-preview .md-code-block {
          background: #09090b;
          border: 1px solid #27272a;
          border-radius: 6px;
          padding: 12px 14px;
          overflow-x: auto;
          font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
          font-size: 13px;
          line-height: 1.6;
          margin: .75em 0;
          position: relative;
        }
        .md-preview .md-code-block[data-lang]::before {
          content: attr(data-lang);
          position: absolute;
          top: 6px;
          right: 10px;
          font-size: 10px;
          color: #52525b;
          text-transform: uppercase;
          letter-spacing: .05em;
        }
        .md-preview .md-link { color: #60a5fa; text-decoration: underline; }
        .md-preview .md-link:hover { color: #93c5fd; }
      `}</style>
    </div>
  );
}
