import React from "react";
import { render, screen } from "@testing-library/react";
import { sanitizeHtml, sanitizeResolverOutput } from "../sanitize";
import { SanitizedTaskOutputViewer } from "@/components/SanitizedTaskOutputViewer";

describe("DOMPurify Security & Stored XSS Neutralization", () => {
  const XSS_PAYLOADS = [
    '<script>alert("xss")</script>',
    '<img src="x" onerror="alert(1)">',
    '<svg onload="alert(1)">',
    '<a href="javascript:alert(1)">Click Me</a>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<body onload="alert(1)">',
  ];

  describe("sanitizeResolverOutput", () => {
    it("strips script tags and executable attributes from dynamic resolver outputs", () => {
      XSS_PAYLOADS.forEach((payload) => {
        const sanitized = sanitizeResolverOutput(payload);
        expect(sanitized).not.toContain("<script>");
        expect(sanitized).not.toContain("onerror");
        expect(sanitized).not.toContain("onload");
        expect(sanitized).not.toContain("javascript:");
      });
    });

    it("sanitizes complex JSON objects containing XSS strings", () => {
      const maliciousObj = {
        status: "success",
        resolverResult: '<script>alert("xss")</script>',
        metadata: {
          payload: '<img src="x" onerror="stealSession()">',
        },
      };

      const sanitized = sanitizeResolverOutput(maliciousObj);
      expect(sanitized).not.toContain("<script>");
      expect(sanitized).not.toContain("onerror");
      expect(sanitized).not.toContain("stealSession");
    });
  });

  describe("sanitizeHtml for Markdown Renders", () => {
    it("strips all malicious XSS vectors from rendered HTML", () => {
      XSS_PAYLOADS.forEach((payload) => {
        const sanitized = sanitizeHtml(payload);
        expect(sanitized).not.toContain("<script>");
        expect(sanitized).not.toContain("onerror");
        expect(sanitized).not.toContain("onload");
        expect(sanitized).not.toContain("javascript:");
        expect(sanitized).not.toContain("<iframe");
      });
    });
  });

  describe("SanitizedTaskOutputViewer Component", () => {
    it("renders dynamic task outputs without executing XSS", () => {
      const maliciousOutput = {
        returnVal: '<script>alert("xss")</script>',
        logs: ["<img src=x onerror=\"alert('pwned')\">"],
      };

      render(<SanitizedTaskOutputViewer output={maliciousOutput} />);

      const viewer = screen.getByTestId("sanitized-output-text");
      expect(viewer.textContent).not.toContain("<script>");
      expect(viewer.textContent).not.toContain("onerror");
    });
  });
});
