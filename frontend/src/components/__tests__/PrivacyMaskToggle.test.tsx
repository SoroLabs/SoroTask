import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import {
  PrivacyMaskToggle,
  PrivacyMaskValue,
  PRIVACY_MASK_ATTR,
  PRIVACY_MASK_STORAGE_KEY,
  usePrivacyMask,
} from "../PrivacyMaskToggle";

expect.extend(toHaveNoViolations);

describe("PrivacyMaskToggle & Zero-Data-Leak Privacy Guard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute(PRIVACY_MASK_ATTR);
    jest.restoreAllMocks();
  });

  it("renders switch button with accessible attributes and shortcut hint", () => {
    render(<PrivacyMaskToggle />);

    const toggle = screen.getByRole("switch", {
      name: /enable privacy mask \(shift\+p\)/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("aria-keyshortcuts", "Shift+P");
    expect(screen.getByText("Shift+P")).toBeInTheDocument();
    expect(document.documentElement.hasAttribute(PRIVACY_MASK_ATTR)).toBe(false);
  });

  it("hides shortcut hint when showShortcutHint is false", () => {
    render(<PrivacyMaskToggle showShortcutHint={false} />);
    expect(screen.queryByText("Shift+P")).not.toBeInTheDocument();
  });

  it("toggles privacy mask on click, updates DOM root attribute, and persists to localStorage", () => {
    const onToggle = jest.fn();
    render(<PrivacyMaskToggle onToggle={onToggle} />);

    const toggle = screen.getByTestId("privacy-mask-toggle");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute(PRIVACY_MASK_ATTR)).toBe("true");
    expect(window.localStorage.getItem(PRIVACY_MASK_STORAGE_KEY)).toBe("true");
    expect(onToggle).toHaveBeenCalledWith(true);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.hasAttribute(PRIVACY_MASK_ATTR)).toBe(false);
    expect(window.localStorage.getItem(PRIVACY_MASK_STORAGE_KEY)).toBe("false");
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("toggles privacy mask via global Shift+P shortcut in under 16ms", () => {
    const onToggle = jest.fn();
    render(<PrivacyMaskToggle onToggle={onToggle} />);

    const start = performance.now();
    fireEvent.keyDown(window, { key: "P", shiftKey: true });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(16);
    expect(document.documentElement.getAttribute(PRIVACY_MASK_ATTR)).toBe("true");
    expect(screen.getByTestId("privacy-mask-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(onToggle).toHaveBeenCalledWith(true);

    fireEvent.keyDown(window, { key: "p", shiftKey: true });
    expect(document.documentElement.hasAttribute(PRIVACY_MASK_ATTR)).toBe(false);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("ignores Shift+P when typing inside input, textarea, or contenteditable elements", () => {
    render(
      <div>
        <PrivacyMaskToggle />
        <input data-testid="text-input" />
        <textarea data-testid="text-area" />
        <div data-testid="editable-div" contentEditable suppressContentEditableWarning />
      </div>,
    );

    fireEvent.keyDown(screen.getByTestId("text-input"), {
      key: "P",
      shiftKey: true,
    });
    expect(document.documentElement.hasAttribute(PRIVACY_MASK_ATTR)).toBe(false);

    fireEvent.keyDown(screen.getByTestId("text-area"), {
      key: "P",
      shiftKey: true,
    });
    expect(document.documentElement.hasAttribute(PRIVACY_MASK_ATTR)).toBe(false);

    fireEvent.keyDown(screen.getByTestId("editable-div"), {
      key: "P",
      shiftKey: true,
    });
    expect(document.documentElement.hasAttribute(PRIVACY_MASK_ATTR)).toBe(false);
  });

  it("ignores Shift+P when combined with Ctrl, Meta, Alt, or key repeat", () => {
    render(<PrivacyMaskToggle />);

    fireEvent.keyDown(window, { key: "P", shiftKey: true, ctrlKey: true });
    fireEvent.keyDown(window, { key: "P", shiftKey: true, metaKey: true });
    fireEvent.keyDown(window, { key: "P", shiftKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "P", shiftKey: true, repeat: true });

    expect(document.documentElement.hasAttribute(PRIVACY_MASK_ATTR)).toBe(false);
  });

  it("restores persisted preference from localStorage on mount", () => {
    window.localStorage.setItem(PRIVACY_MASK_STORAGE_KEY, "true");
    render(<PrivacyMaskToggle />);

    expect(document.documentElement.getAttribute(PRIVACY_MASK_ATTR)).toBe("true");
    expect(screen.getByTestId("privacy-mask-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("handles localStorage errors gracefully without crashing", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    render(<PrivacyMaskToggle />);
    const toggle = screen.getByTestId("privacy-mask-toggle");
    expect(() => fireEvent.click(toggle)).not.toThrow();
    expect(document.documentElement.getAttribute(PRIVACY_MASK_ATTR)).toBe("true");
  });

  it("synchronizes state across components and cross-tab storage events", () => {
    function StatusProbe() {
      const { isMasked } = usePrivacyMask();
      return <span data-testid="probe">{isMasked ? "masked" : "visible"}</span>;
    }

    render(
      <div>
        <PrivacyMaskToggle />
        <StatusProbe />
      </div>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("visible");

    fireEvent.click(screen.getByTestId("privacy-mask-toggle"));
    expect(screen.getByTestId("probe")).toHaveTextContent("masked");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: PRIVACY_MASK_STORAGE_KEY,
          newValue: "false",
        }),
      );
    });

    expect(screen.getByTestId("probe")).toHaveTextContent("visible");
    expect(document.documentElement.hasAttribute(PRIVACY_MASK_ATTR)).toBe(false);
  });

  it("PrivacyMaskValue marks sensitive content and supports text replacement mode", () => {
    render(
      <div>
        <PrivacyMaskToggle />
        <PrivacyMaskValue>12,450.00 XLM</PrivacyMaskValue>
        <PrivacyMaskValue replaceText fallback="***">
          GABC123456789
        </PrivacyMaskValue>
      </div>,
    );

    expect(screen.getByText("12,450.00 XLM")).toHaveAttribute(
      "data-privacy-sensitive",
      "true",
    );
    expect(screen.getByText("GABC123456789")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("privacy-mask-toggle"));

    expect(screen.getByText("12,450.00 XLM")).toHaveAttribute(
      "aria-label",
      "Sensitive value hidden by privacy mask",
    );
    expect(screen.queryByText("GABC123456789")).not.toBeInTheDocument();
    expect(screen.getByText("***")).toBeInTheDocument();
  });

  it("has no accessibility violations in either state", async () => {
    const { container } = render(<PrivacyMaskToggle />);

    let results = await axe(container);
    expect(results).toHaveNoViolations();

    fireEvent.click(screen.getByTestId("privacy-mask-toggle"));
    results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
