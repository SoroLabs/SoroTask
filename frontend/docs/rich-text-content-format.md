# Rich Text Content Format

## Editor Choice: Tiptap

Tiptap was selected over Lexical and Slate because it:
- Has first-class React support with a clean hook API (`useEditor`)
- Produces a serializable JSON format (ProseMirror document model) with no framework lock-in
- Provides `@tiptap/html` for server-side HTML generation without a browser
- Has a well-maintained extension ecosystem (StarterKit, Link, CodeBlock, Placeholder)

## Stored Format

Task descriptions are stored as **Tiptap JSON** (ProseMirror document model):

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "My Task" }]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Normal text and " },
        { "type": "text", "text": "bold text", "marks": [{ "type": "bold" }] }
      ]
    },
    {
      "type": "bulletList",
      "content": [
        {
          "type": "listItem",
          "content": [
            { "type": "paragraph", "content": [{ "type": "text", "text": "item" }] }
          ]
        }
      ]
    }
  ]
}
```

### Why JSON, not HTML?

| Concern | JSON | HTML |
|---|---|---|
| XSS surface | None — no executable content | Must sanitize on every read |
| Portability | Framework-agnostic | Renderer-dependent |
| Diffing / history | Structured, easy to diff | String diffing only |
| Validation | Schema-checkable | Fragile |

The JSON is converted to HTML only at render time via `generateHTML` (Tiptap), then immediately sanitized by DOMPurify before being injected into the DOM.

## Supported Formatting

| Feature | Tiptap node/mark |
|---|---|
| Bold | `bold` mark |
| Italic | `italic` mark |
| Strikethrough | `strike` mark |
| Inline code | `code` mark |
| Heading (H1–H3) | `heading` node |
| Bullet list | `bulletList` + `listItem` |
| Ordered list | `orderedList` + `listItem` |
| Blockquote | `blockquote` node |
| Code block | `codeBlock` node |
| Link | `link` mark (href, target, rel) |

## Security Model

### Render pipeline

```
TaskContent (JSON)
  → generateHTML()       [Tiptap — converts JSON to HTML string]
  → sanitizeHtml()       [DOMPurify — strips disallowed tags/attrs]
  → addSafeLinkAttributes()  [adds target="_blank" rel="noopener noreferrer"]
  → dangerouslySetInnerHTML  [React — injects clean HTML]
```

### DOMPurify allowlist

Only these tags are permitted in rendered output:

```
p, br, strong, em, s, code, h1, h2, h3,
ul, ol, li, blockquote, pre, a, hr
```

Only these attributes are permitted:

```
href, target, rel, class
```

All other tags and attributes — including `<script>`, `<iframe>`, `<object>`,
`onerror`, `onclick`, `style`, `data:` URIs, and `javascript:` hrefs — are
stripped before the HTML reaches the DOM.

### What this protects against

- **Stored XSS**: malicious content saved to the database cannot execute in the browser
- **Reflected XSS**: even if the JSON is tampered with in transit, the sanitizer strips executable content
- **Open redirects via links**: all links get `rel="noopener noreferrer"` and open in a new tab

## Components

### `RichTextEditor`

```tsx
import RichTextEditor from "@/src/components/RichTextEditor";

<RichTextEditor
  initialContent={task.description}   // TaskContent | null
  placeholder="Add a description…"    // optional
  onChange={(content) => save(content)} // called on every keystroke
/>
```

### `RichTextRenderer`

```tsx
import RichTextRenderer from "@/src/components/RichTextRenderer";

<RichTextRenderer
  content={task.description}   // TaskContent (required)
  className="my-class"         // optional
/>
```

## TypeScript Types

```ts
// src/types/task.ts
interface TaskContent {
  type: "doc";
  content: TiptapNode[];
}

interface Task {
  id: string;
  title: string;
  description: TaskContent | null;
  createdAt: string;
  updatedAt: string;
}
```
