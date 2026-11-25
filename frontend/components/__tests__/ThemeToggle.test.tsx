import { useEffect, useState } from "react";
import { renderToString } from "react-dom/server";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setTheme = jest.fn();
let themeValue: string | undefined = "system";
let resolvedValue: string | undefined = "light";
/** Set by the harness so a `setTheme` call can force a re-render, the way
 *  next-themes does when it writes the choice back to localStorage. */
let requestRerender: (() => void) | undefined;

jest.mock("next-themes", () => ({
  useTheme: () => ({
    theme: themeValue,
    resolvedTheme: resolvedValue,
    setTheme,
  }),
}));

import { ThemeToggle } from "../ThemeToggle";

function Harness() {
  const [, force] = useState(0);
  useEffect(() => {
    requestRerender = () => force((n) => n + 1);
  }, []);
  return <ThemeToggle />;
}

beforeEach(() => {
  themeValue = "system";
  resolvedValue = "light";
  requestRerender = undefined;
  setTheme.mockReset();
  // next-themes writes the choice back and re-renders; the mock has to do the
  // same or the toggle would keep computing the same successor on every click.
  setTheme.mockImplementation((next: string) => {
    themeValue = next;
    requestRerender?.();
  });
});

/** Renders and waits past the mount effect that reveals the real button. */
async function mount() {
  const result = render(<Harness />);
  await waitFor(() =>
    expect(screen.queryByTestId("theme-toggle")).toBeInTheDocument(),
  );
  return result;
}

describe("ThemeToggle", () => {
  it("server-renders a correctly sized placeholder rather than nothing", () => {
    // The pre-hydration markup is what the browser lays out before React runs,
    // so `renderToString` is the faithful way to inspect it — `render()` wraps
    // in act() and flushes the mount effect immediately.
    //
    // The previous version returned `null` here, which removed the button from
    // the header and reflowed the whole page on every load.
    const html = renderToString(<ThemeToggle />);

    expect(html).toContain('data-testid="theme-toggle-placeholder"');
    expect(html).toContain("w-9");
    expect(html).toContain("h-9");
    expect(html).not.toContain('data-testid="theme-toggle"');
  });

  it("cycles light -> dark -> oled -> system -> light", async () => {
    themeValue = "light";
    await mount();

    expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
      "data-theme",
      "light",
    );
    for (const expected of ["dark", "oled", "system", "light"]) {
      fireEvent.click(screen.getByTestId("theme-toggle"));
      expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
        "data-theme",
        expected,
      );
    }
    expect(setTheme).toHaveBeenCalledTimes(4);
  });

  it("labels itself with the active mode", async () => {
    themeValue = "oled";
    await mount();
    const button = screen.getByTestId("theme-toggle");
    expect(button).toHaveAttribute("data-theme", "oled");
    expect(button).toHaveAttribute(
      "aria-label",
      expect.stringContaining("High-contrast OLED"),
    );
  });

  it("announces what `system` currently resolves to", async () => {
    themeValue = "system";
    resolvedValue = "oled";
    await mount();
    expect(screen.getByTestId("theme-toggle").textContent).toContain(
      "resolving to oled",
    );
  });

  it("falls back to the system mode when the stored value is unusable", async () => {
    themeValue = "solarized";
    await mount();
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
      "data-theme",
      "system",
    );
  });

  it("does not claim a resolved theme for explicit modes", async () => {
    themeValue = "dark";
    resolvedValue = "dark";
    await mount();
    expect(screen.getByTestId("theme-toggle").textContent).not.toContain(
      "resolving to",
    );
  });

  it("treats an unresolved theme as light rather than crashing", async () => {
    themeValue = "system";
    resolvedValue = undefined;
    await mount();
    expect(screen.getByTestId("theme-toggle").textContent).toContain(
      "resolving to light",
    );
  });
});
