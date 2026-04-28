/**
 * Task content is stored as Tiptap JSON (ProseMirror document model).
 * This is a serializable, framework-agnostic format that can be safely
 * persisted to a database and rendered back without re-parsing HTML.
 *
 * Format: { type: "doc", content: [...nodes] }
 *
 * On read, content is rendered via RichTextRenderer which sanitizes
 * the generated HTML with DOMPurify before injecting into the DOM.
 */
export interface TaskContent {
  type: "doc";
  content: TiptapNode[];
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface Task {
  id: string;
  title: string;
  description: TaskContent | null;
  createdAt: string;
  updatedAt: string;
}

// ── Dependency graph types ────────────────────────────────────────────────────

/** A directed dependency edge: `from` is blocked by `to` */
export interface TaskDependency {
  /** The task that depends on another (the blocked task) */
  fromId: string;
  /** The task that must complete first (the blocking task) */
  toId: string;
}

/** Graph node shape consumed by the graph component */
export interface GraphNode {
  id: string;
  label: string;
  /** True when this node is the currently focused/selected task */
  selected: boolean;
}

/** Graph edge shape consumed by the graph component */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}
