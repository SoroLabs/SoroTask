import { sanitizeHtml, addSafeLinkAttributes } from "../sanitize";

// DOMPurify requires a real DOM — jsdom provides it in the test environment.

describe("sanitizeHtml", () => {
  it("passes through safe HTML unchanged", () => {
    const input = "<p>Hello <strong>world</strong></p>";
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("strips script tags (XSS vector)", () => {
    const input = '<p>Safe</p><script>alert("xss")</script>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("<p>Safe</p>");
  });

  it("strips onerror attributes (XSS vector)", () => {
    const input = '<img src="x" onerror="alert(1)">';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  it("strips javascript: href (XSS vector)", () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("javascript:");
  });

  it("strips disallowed tags like <iframe>", () => {
    const input = '<iframe src="https://evil.com"></iframe><p>ok</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("<iframe");
    expect(result).toContain("<p>ok</p>");
  });

  it("strips disallowed tags like <object>", () => {
    const input = '<object data="evil.swf"></object>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("<object");
  });

  it("strips style attributes", () => {
    const input = '<p style="color:red">text</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("style=");
  });

  it("preserves allowed formatting tags", () => {
    const tags = ["<strong>b</strong>", "<em>i</em>", "<s>s</s>", "<code>c</code>"];
    for (const tag of tags) {
      expect(sanitizeHtml(tag)).toContain(tag);
    }
  });

  it("preserves heading tags h1–h3", () => {
    expect(sanitizeHtml("<h1>Title</h1>")).toContain("<h1>Title</h1>");
    expect(sanitizeHtml("<h2>Sub</h2>")).toContain("<h2>Sub</h2>");
    expect(sanitizeHtml("<h3>Sub</h3>")).toContain("<h3>Sub</h3>");
  });

  it("preserves list tags", () => {
    const input = "<ul><li>item</li></ul>";
    expect(sanitizeHtml(input)).toContain("<ul><li>item</li></ul>");
  });

  it("preserves blockquote", () => {
    expect(sanitizeHtml("<blockquote>quote</blockquote>")).toContain(
      "<blockquote>quote</blockquote>"
    );
  });

  it("preserves pre/code blocks", () => {
    const input = "<pre><code>const x = 1;</code></pre>";
    expect(sanitizeHtml(input)).toContain(input);
  });

  it("preserves safe anchor tags", () => {
    const input = '<a href="https://example.com">link</a>';
    const result = sanitizeHtml(input);
    expect(result).toContain('href="https://example.com"');
  });

  it("handles empty string", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("handles plain text without tags", () => {
    expect(sanitizeHtml("just text")).toBe("just text");
  });

  it("strips data: URIs in href", () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">x</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("data:");
  });

  it("strips event handler attributes like onclick", () => {
    const input = '<p onclick="evil()">text</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("onclick");
  });
});

describe("addSafeLinkAttributes", () => {
  it("adds target and rel to links missing them", () => {
    const input = '<a href="https://example.com">link</a>';
    const result = addSafeLinkAttributes(input);
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("does not duplicate target if already present", () => {
    const input = '<a href="https://example.com" target="_blank">link</a>';
    const result = addSafeLinkAttributes(input);
    const targetCount = (result.match(/target=/g) ?? []).length;
    expect(targetCount).toBe(1);
  });

  it("does not duplicate rel if already present", () => {
    const input =
      '<a href="https://example.com" rel="noopener noreferrer">link</a>';
    const result = addSafeLinkAttributes(input);
    const relCount = (result.match(/rel=/g) ?? []).length;
    expect(relCount).toBe(1);
  });

  it("handles multiple links", () => {
    const input =
      '<a href="https://a.com">A</a> and <a href="https://b.com">B</a>';
    const result = addSafeLinkAttributes(input);
    const targetCount = (result.match(/target="_blank"/g) ?? []).length;
    expect(targetCount).toBe(2);
  });

  it("returns non-link HTML unchanged", () => {
    const input = "<p>no links here</p>";
    expect(addSafeLinkAttributes(input)).toBe(input);
  });
});
