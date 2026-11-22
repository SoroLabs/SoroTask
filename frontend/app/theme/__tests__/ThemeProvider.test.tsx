import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../ThemeProvider";
import { ThemeToggle } from "../ThemeToggle";
import { initHoudiniThemeEngine } from "@/src/lib/theme/houdiniThemeEngine";

jest.mock("@/src/lib/theme/houdiniThemeEngine", () => ({
  initHoudiniThemeEngine: jest.fn(async () => ({
    usingHoudini: true,
    source: "fallback",
    tokens: {
      background: "#000",
      foreground: "#fff",
      accent: "#3b82f6",
      surface: "#111",
    },
  })),
}));

function Consumer() {
  const { mode, setMode } = useTheme();
  return (
    <div>
      <div data-testid="theme-mode">{mode}</div>
      <button onClick={() => setMode("dark")}>set-dark</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    jest.clearAllMocks();
  });

  afterAll(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("initializes Houdini theme engine on mount", () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(initHoudiniThemeEngine).toHaveBeenCalled();
  });

  it("hydrates mode from localStorage and applies theme", () => {
    localStorage.setItem("theme", "dark");

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("updates mode and stores selection", () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("set-dark"));

    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("supports persistent high-contrast mode from the accessible theme selector", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "High contrast theme" }));

    expect(localStorage.getItem("theme")).toBe("high-contrast");
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "high-contrast",
    );
    expect(
      screen.getByRole("button", { name: "High contrast theme" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("exposes each theme choice as a keyboard-operable button", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByRole("group", { name: "Color theme" })).toBeInTheDocument();
    for (const label of ["Light", "Dark", "System", "High contrast"]) {
      expect(
        screen.getByRole("button", { name: `${label} theme` }),
      ).toHaveAttribute("type", "button");
    }
  });
});
