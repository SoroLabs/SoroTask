"use client";

import { useEffect, useMemo } from "react";

type Options = {
  isDirty: boolean;
  message?: string;
};

const DEFAULT_MESSAGE = "You have unsaved changes. Leave this page and discard them?";

export function useUnsavedChangesGuard({ isDirty, message = DEFAULT_MESSAGE }: Options) {
  const prompt = useMemo(() => message, [message]);

  useEffect(() => {
    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = prompt;
    };

    const clickHandler = (event: MouseEvent) => {
      if (!isDirty) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;

      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }

      const shouldLeave = window.confirm(prompt);
      if (!shouldLeave) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
    document.addEventListener("click", clickHandler, true);

    return () => {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      document.removeEventListener("click", clickHandler, true);
    };
  }, [isDirty, prompt]);

  return {
    confirmDiscard: () => !isDirty || window.confirm(prompt),
  };
}
