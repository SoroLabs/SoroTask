import React from "react";
import { render, screen } from "@testing-library/react";
import RichTextRenderer from "../RichTextRenderer";
import type { TaskContent } from "@/src/types/task";

// generateHTML runs in Node/jsdom — no browser needed for the renderer tests.

const paragraphContent: TaskContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Hello world" }],
    },
  ],
};

const headingContent: TaskContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "My Heading" }],
    },
  ],
};

const boldContent: TaskContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "bold text",
          marks: [{ type: "bold" }],
        },
      ],
    },
  ],
};

const linkContent: TaskContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "visit site",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    },
  ],
};

const listContent: TaskContent = {
  type: "doc",
  content: [
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "item one" }],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "item two" }],
            },
          ],
        },
      ],
    },
  ],
};

const codeBlockContent: TaskContent = {
  type: "doc",
  content: [
    {
      type: "codeBlock",
      content: [{ type: "text", text: "const x = 1;" }],
    },
  ],
};

describe("RichTextRenderer", () => {
  describe("rendering", () => {
    it("renders paragraph text", () => {
      render(<RichTextRenderer content={paragraphContent} />);
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("renders heading text", () => {
      render(<RichTextRenderer content={headingContent} />);
      expect(screen.getByText("My Heading")).toBeInTheDocument();
    });

    it("renders bold text inside a <strong> tag", () => {
      const { container } = render(<RichTextRenderer content={boldContent} />);
      expect(container.querySelector("strong")).toBeInTheDocument();
      expect(container.querySelector("strong")?.textContent).toBe("bold text");
    });

    it("renders a link with correct href", () => {
      const { container } = render(<RichTextRenderer content={linkContent} />);
      const anchor = container.querySelector("a");
      expect(anchor).toBeInTheDocument();
      expect(anchor?.getAttribute("href")).toBe("https://example.com");
    });

    it("renders bullet list items", () => {
      render(<RichTextRenderer content={listContent} />);
      expect(screen.getByText("item one")).toBeInTheDocument();
      expect(screen.getByText("item two")).toBeInTheDocument();
    });

    it("renders code block content", () => {
      render(<RichTextRenderer content={codeBlockContent} />);
      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    });

    it("applies custom className", () => {
      const { container } = render(
        <RichTextRenderer content={paragraphContent} className="custom-class" />
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });

    it("applies data-testid", () => {
      render(
        <RichTextRenderer content={paragraphContent} data-testid="renderer" />
      );
      expect(screen.getByTestId("renderer")).toBeInTheDocument();
    });
  });

  describe("security — XSS prevention", () => {
    it("does not render script tags injected via text content", () => {
      const xssContent: TaskContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: '<script>alert("xss")</script>' },
            ],
          },
        ],
      };
      const { container } = render(<RichTextRenderer content={xssContent} />);
      expect(container.querySelector("script")).toBeNull();
      expect(container.innerHTML).not.toContain("<script>");
    });

    it("adds safe link attributes (target and rel) to rendered links", () => {
      const { container } = render(<RichTextRenderer content={linkContent} />);
      const anchor = container.querySelector("a");
      expect(anchor?.getAttribute("target")).toBe("_blank");
      expect(anchor?.getAttribute("rel")).toContain("noopener");
    });

    it("does not render iframe tags", () => {
      // Simulate a tampered JSON that somehow contains raw HTML in a text node
      const tampered: TaskContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: '<iframe src="https://evil.com"></iframe>',
              },
            ],
          },
        ],
      };
      const { container } = render(<RichTextRenderer content={tampered} />);
      expect(container.querySelector("iframe")).toBeNull();
    });
  });

  describe("save and load round-trip", () => {
    it("renders content that was serialized and passed back in", () => {
      // Simulates: editor.getJSON() → store → load back into renderer
      const savedContent: TaskContent = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Saved Heading" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Saved paragraph text." }],
          },
        ],
      };
      render(<RichTextRenderer content={savedContent} />);
      expect(screen.getByText("Saved Heading")).toBeInTheDocument();
      expect(screen.getByText("Saved paragraph text.")).toBeInTheDocument();
    });

    it("renders italic text correctly after round-trip", () => {
      const italicContent: TaskContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "italic",
                marks: [{ type: "italic" }],
              },
            ],
          },
        ],
      };
      const { container } = render(
        <RichTextRenderer content={italicContent} />
      );
      expect(container.querySelector("em")).toBeInTheDocument();
    });

    it("renders ordered list after round-trip", () => {
      const orderedList: TaskContent = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const { container } = render(
        <RichTextRenderer content={orderedList} />
      );
      expect(container.querySelector("ol")).toBeInTheDocument();
      expect(screen.getByText("first")).toBeInTheDocument();
    });
  });
});
