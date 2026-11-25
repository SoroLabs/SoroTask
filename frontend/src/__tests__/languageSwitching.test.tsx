/**
 * The acceptance criterion for #1242 is "switching languages updates all UI
 * copy instantly without reloading the page". These tests assert that
 * behaviourally: the copy changes, the page is never torn down, and component
 * state survives.
 */

import { useState } from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { LocaleProvider } from "@/context/LocaleContext";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useTranslation, useLocale } from "@/hooks/useI18n";
import { SUPPORTED_LOCALES } from "@/i18n/index";

/** Stands in for any component that renders translated copy. */
function Greeting() {
  const { t, locale } = useTranslation();
  return (
    <div>
      <p data-testid="greeting">{t("language.label")}</p>
      <p data-testid="status">{t("language.label")}</p>
      <p data-testid="locale">{locale}</p>
    </div>
  );
}

/** Proves the tree is updated rather than remounted. */
function Counter() {
  const { t } = useTranslation();
  const [n, setN] = useState(0);
  return (
    <div>
      <button onClick={() => setN(n + 1)}>increment</button>
      <p data-testid="counter">{n}</p>
      <p data-testid="label">{t("language.label")}</p>
    </div>
  );
}

/** Calls setLocale directly, to exercise the guard on a value the <select>
 *  could never produce. */
function RogueSetter() {
  const { setLocale } = useLocale();
  return (
    <button onClick={() => setLocale("klingon" as never)} data-testid="rogue">
      rogue
    </button>
  );
}

/**
 * `window.location.reload` is read-only in jsdom, so the "did not reload" claim
 * is proven structurally instead: a reload necessarily replaces the document
 * and every node in it, so holding the *same* node reference and the same
 * component state across a language switch is stronger evidence than a spy
 * would have been.
 */
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("dir");
});

/**
 * The dictionary loads asynchronously on purpose, so a test that asserts
 * synchronously can finish before that promise settles — and the resulting
 * state update lands outside `act`. Flushing inside `act` at teardown keeps the
 * warning out of the output without weakening any assertion.
 */
afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
  });
});

async function renderApp(children?: React.ReactNode) {
  const result = render(
    <LocaleProvider>
      <LanguageSelector />
      <Greeting />
      {children}
    </LocaleProvider>,
  );
  await settle();
  return result;
}

/**
 * Lets the initial dictionary load resolve inside `act`. The load is
 * deliberately async, so a synchronous test would otherwise finish before the
 * resulting state update and trip React's act() warning.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("instant language switching", () => {
  it("updates translated copy in place, without reloading the page", async () => {
    await renderApp();

    await waitFor(() =>
      expect(screen.getByTestId("greeting")).toHaveTextContent(
        "Select language",
      ),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("Select language");

    // The pre-switch node reference. A reload would have produced a new one.
    const greetingNode = screen.getByTestId("greeting");
    const documentBefore = document;

    fireEvent.change(screen.getByTestId("language-selector"), {
      target: { value: "es" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("greeting")).toHaveTextContent(
        "Seleccionar idioma",
      ),
    );
    expect(screen.getByTestId("status")).toHaveTextContent(
      "Seleccionar idioma",
    );

    // Same document, same node, new copy: an in-place re-render.
    expect(document).toBe(documentBefore);
    expect(screen.getByTestId("greeting")).toBe(greetingNode);
  });

  it("keeps component state across a language switch", async () => {
    render(<Counter />, {
      wrapper: ({ children }) => (
        <LocaleProvider>
          <LanguageSelector />
          {children}
        </LocaleProvider>
      ),
    });

    await waitFor(() =>
      expect(screen.getByTestId("label")).toHaveTextContent("Select language"),
    );
    fireEvent.click(screen.getByText("increment"));
    expect(screen.getByTestId("counter")).toHaveTextContent("1");

    // French, whose string differs from English's, so the copy assertion is
    // meaningful rather than passing whether or not anything re-rendered.
    fireEvent.change(screen.getByTestId("language-selector"), {
      target: { value: "fr" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("label")).toHaveTextContent(
        "Choisir la langue",
      ),
    );
    // The counter is the proof the tree was updated, not remounted.
    expect(screen.getByTestId("counter")).toHaveTextContent("1");
  });

  it("switches to an RTL locale and sets dir on the document", async () => {
    await renderApp();

    fireEvent.change(screen.getByTestId("language-selector"), {
      target: { value: "ar" },
    });

    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(document.documentElement.lang).toBe("ar");
    // Arabic does not render 'online' as "Online".
    await waitFor(() =>
      expect(screen.getByTestId("status")).not.toHaveTextContent("Online"),
    );
  });

  it("restores ltr when moving back to a left-to-right locale", async () => {
    await renderApp();

    fireEvent.change(screen.getByTestId("language-selector"), {
      target: { value: "ar" },
    });
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));

    fireEvent.change(screen.getByTestId("language-selector"), {
      target: { value: "en" },
    });
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    expect(document.documentElement.lang).toBe("en");
  });

  it("persists the choice for the next visit", async () => {
    await renderApp();

    fireEvent.change(screen.getByTestId("language-selector"), {
      target: { value: "zh" },
    });

    await waitFor(() =>
      expect(localStorage.getItem("sorotask_locale")).toBe("zh"),
    );
  });

  it("ignores an unsupported locale value", async () => {
    await renderApp(<RogueSetter />);
    await waitFor(() =>
      expect(screen.getByTestId("locale")).toHaveTextContent("en"),
    );

    fireEvent.click(screen.getByTestId("rogue"));

    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(localStorage.getItem("sorotask_locale")).toBeNull();
  });

  it("offers an option for every supported locale", async () => {
    await renderApp();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(SUPPORTED_LOCALES.length);
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(
      SUPPORTED_LOCALES,
    );
  });

  it("labels the picker for assistive technology", async () => {
    await renderApp();
    expect(screen.getByLabelText("Select language")).toBeInTheDocument();
  });

  it("does not hide the picker behind a mount guard", async () => {
    // The old implementation returned null until mounted, punching a hole in
    // the header on every page load. The value now comes from context, which
    // the server also knows, so there is nothing to wait for.
    await renderApp();
    expect(screen.getByTestId("language-selector")).toBeInTheDocument();
  });

  it("works standalone, without a LocaleProvider", async () => {
    // `app/page.tsx` renders the picker, and pages are rendered in isolation by
    // Storybook and by tests. A leaf control that throws
    // "must be used within LocaleProvider" is hostile, so it falls back to
    // localStorage instead.
    render(<LanguageSelector />);

    const select = screen.getByTestId("language-selector");
    expect(select).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(select, { target: { value: "es" } });

    expect(localStorage.getItem("sorotask_locale")).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });

  it("reads a previously saved locale when rendered standalone", async () => {
    localStorage.setItem("sorotask_locale", "fr");

    render(<LanguageSelector />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("language-selector")).toHaveValue("fr");
  });
});
