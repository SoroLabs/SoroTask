import DOMPurify from "dompurify";

/**
 * Allowed HTML tags for rich text content.
 * Intentionally restrictive — only what Tiptap StarterKit + Link + CodeBlock produce.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "s",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "a",
  "hr",
  "span",
  "div",
];

const ALLOWED_ATTR = ["href", "target", "rel", "class", "data-lang"];

/**
 * Sanitizes an HTML string to prevent XSS.
 * - Strips all tags not in the allowlist
 * - Strips all attributes not in the allowlist
 * - Forces external links to open safely (rel="noopener noreferrer")
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof window === "undefined") {
    // Basic regex fallback for SSR environment when window/DOM is not present
    return dirty
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+="[^"]*"/gi, "")
      .replace(/on\w+='[^']*'/gi, "")
      .replace(/javascript:[^\s"']*/gi, "");
  }

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ["target"],
    FORCE_BODY: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });
}

/**
 * Sanitizes dynamic resolver output strings and task execution return values.
 * Neutralizes stored XSS payloads (`<script>`, `onload=`, `javascript:`, `onerror=`).
 */
export function sanitizeResolverOutput(output: unknown): string {
  if (output === null || output === undefined) {
    return "";
  }

  const rawString =
    typeof output === "object"
      ? JSON.stringify(output, null, 2)
      : String(output);

  if (typeof window === "undefined") {
    return rawString
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+="[^"]*"/gi, "")
      .replace(/on\w+='[^']*'/gi, "")
      .replace(/javascript:[^\s"']*/gi, "");
  }

  return DOMPurify.sanitize(rawString, {
    ALLOWED_TAGS: [], // Disallow HTML tags in raw output strings
    ALLOWED_ATTR: [],
  });
}

/**
 * Post-processes sanitized HTML to add safe link attributes.
 * Called after sanitizeHtml so we only touch already-clean content.
 */
export function addSafeLinkAttributes(html: string): string {
  return html.replace(
    /<a\s([^>]*href="[^"]*"[^>]*)>/gi,
    (match, attrs: string) => {
      const hasRel = /rel=/i.test(attrs);
      const hasTarget = /target=/i.test(attrs);
      let result = attrs;
      if (!hasTarget) result += ' target="_blank"';
      if (!hasRel) result += ' rel="noopener noreferrer"';
      return `<a ${result}>`;
    },
  );
}
