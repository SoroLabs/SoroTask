import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AIAssistantProvider, useAIAssistantContext } from "../ContextProvider";
import { getAIClient } from "@/src/lib/ai/openai-client";

jest.mock("@/src/lib/ai/openai-client", () => ({
  getAIClient: jest.fn(() => ({
    chat: jest.fn(() =>
      Promise.resolve({
        content: "Here are some suggestions for the Tasks page.",
      })
    ),
  })),
  AIMessage: {},
  AIServiceError: class extends Error {
    code: string;
    originalError?: Error;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

function Harness({ initialPathname = "/tasks" }: { initialPathname?: string }) {
  const ctx = useAIAssistantContext();
  return (
    <div>
      <span data-testid="is-open">{ctx.isOpen ? "open" : "closed"}</span>
      <span data-testid="error">{ctx.error ?? "none"}</span>
      <span data-testid="messages">{ctx.messages.length}</span>
      <span data-testid="suggestions">{ctx.suggestions.join(",")}</span>
      <span data-testid="page-route">{ctx.pageContext?.route ?? "none"}</span>
      <span data-testid="suggesting">{ctx.isSuggesting ? "yes" : "no"}</span>
      <button data-testid="toggle" onClick={ctx.togglePanel} />
      <button data-testid="send" onClick={() => ctx.sendMessage("Hello")} />
      <button data-testid="suggest" onClick={ctx.suggest} />
      <button data-testid="retry" onClick={ctx.retryLastMessage} />
      <button data-testid="reset" onClick={ctx.resetConversation} />
      <button data-testid="clear-error" onClick={ctx.clearError} />
    </div>
  );
}

const originalUsePathname = jest.requireMock("next/navigation")?.usePathname;

jest.mock("next/navigation", () => {
  const actual = jest.requireActual("next/navigation");
  return {
    ...actual,
    usePathname: jest.fn(),
  };
});

const mockUsePathname = require("next/navigation").usePathname as jest.Mock;

describe("AIAssistantProvider", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/tasks");
    (getAIClient as jest.Mock).mockClear();
    (getAIClient as jest.Mock).mockReturnValue({
      chat: jest.fn(() =>
        Promise.resolve({
          content: "Mock AI response",
        })
      ),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders children and provides default state", () => {
    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    expect(screen.getByTestId("is-open")).toHaveTextContent("closed");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(screen.getByTestId("messages")).toHaveTextContent("0");
  });

  it("toggles panel open and closed", async () => {
    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("is-open")).toHaveTextContent("open");

    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("is-open")).toHaveTextContent("closed");
  });

  it("determines page context from pathname", () => {
    mockUsePathname.mockReturnValue("/dashboard");
    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    expect(screen.getByTestId("page-route")).toHaveTextContent("/dashboard");
  });

  it("falls back page context for unknown routes", () => {
    mockUsePathname.mockReturnValue("/unknown-route");
    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    expect(screen.getByTestId("page-route")).toHaveTextContent("none");
  });

  it("sends a message and updates history", async () => {
    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("send"));

    await waitFor(() => {
      expect(screen.getByTestId("messages")).toHaveTextContent("2");
    });
  });

  it("sets error when AI client is missing", async () => {
    (getAIClient as jest.Mock).mockImplementation(() => {
      throw new Error("Missing API key");
    });

    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("error")).not.toHaveTextContent("none");
    });
  });

  it("clears error when clearError is called", async () => {
    (getAIClient as jest.Mock).mockImplementation(() => {
      throw new Error("Missing API key");
    });

    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("error")).not.toHaveTextContent("none");
    });

    fireEvent.click(screen.getByTestId("clear-error"));
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("generates suggestions when suggest is called", async () => {
    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("suggest"));

    expect(screen.getByTestId("suggesting")).toHaveTextContent("yes");

    await waitFor(() => {
      expect(screen.getByTestId("suggesting")).toHaveTextContent("no");
      expect(screen.getByTestId("suggestions")).toHaveTextContent(
        "Mock AI response"
      );
    }, { timeout: 3000 });
  });

  it("falls back to route-specific suggestions on AI failure", async () => {
    (getAIClient as jest.Mock).mockReturnValue({
      chat: jest.fn(() => Promise.reject(new Error("Network error"))),
    });

    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("suggest"));

    await waitFor(() => {
      expect(screen.getByTestId("suggesting")).toHaveTextContent("no");
      expect(screen.getByTestId("suggestions")).toHaveTextContent(
        "Create new task"
      );
    }, { timeout: 3000 });
  });

  it("retries the last user message", async () => {
    const chatMock = jest.fn(() =>
      Promise.resolve({ content: "Retried response" })
    );
    (getAIClient as jest.Mock).mockReturnValue({ chat: chatMock });

    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("send"));
    await waitFor(() => {
      expect(screen.getByTestId("messages")).toHaveTextContent("2");
    });

    chatMock.mockClear();
    fireEvent.click(screen.getByTestId("retry"));

    await waitFor(() => {
      expect(chatMock).toHaveBeenCalled();
    });
  });

  it("resets conversation state", async () => {
    render(
      <AIAssistantProvider>
        <Harness />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("send"));
    await waitFor(() => {
      expect(screen.getByTestId("messages")).toHaveTextContent("2");
    });

    fireEvent.click(screen.getByTestId("reset"));
    expect(screen.getByTestId("messages")).toHaveTextContent("0");
    expect(screen.getByTestId("suggestions")).toHaveTextContent("");
  });
});
