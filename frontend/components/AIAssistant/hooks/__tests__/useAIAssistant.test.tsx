import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useAIAssistant } from "../useAIAssistant";
import { AIAssistantProvider, useAIAssistantContext } from "../../ContextProvider";
import { getAIClient } from "@/src/lib/ai/openai-client";

jest.mock("@/src/lib/ai/openai-client", () => ({
  getAIClient: jest.fn(() => ({
    chat: jest.fn(() =>
      Promise.resolve({
        content: "AI response text",
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

function TestConsumer() {
  const ctx = useAIAssistantContext();
  return (
    <div>
      <span data-testid="is-open">{ctx.isOpen ? "open" : "closed"}</span>
      <span data-testid="messages">{ctx.messages.length}</span>
      <span data-testid="isLoading">{ctx.isLoading ? "yes" : "no"}</span>
      <span data-testid="error">{ctx.error ?? "none"}</span>
      <span data-testid="suggestions">{ctx.suggestions.length}</span>
      <button data-testid="toggle" onClick={ctx.togglePanel} />
      <button data-testid="open" onClick={ctx.openPanel} />
      <button data-testid="close" onClick={ctx.closePanel} />
    </div>
  );
}

describe("useAIAssistant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exposes AIAssistantContext values", () => {
    render(
      <AIAssistantProvider>
        <TestConsumer />
      </AIAssistantProvider>
    );

    expect(screen.getByTestId("is-open")).toHaveTextContent("closed");
    expect(screen.getByTestId("messages")).toHaveTextContent("0");
    expect(screen.getByTestId("isLoading")).toHaveTextContent("no");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("toggles panel state", () => {
    render(
      <AIAssistantProvider>
        <TestConsumer />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("is-open")).toHaveTextContent("open");

    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("is-open")).toHaveTextContent("closed");
  });

  it("opens panel directly", () => {
    render(
      <AIAssistantProvider>
        <TestConsumer />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("is-open")).toHaveTextContent("open");
  });

  it("closes panel directly", () => {
    render(
      <AIAssistantProvider>
        <TestConsumer />
      </AIAssistantProvider>
    );

    fireEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("is-open")).toHaveTextContent("open");

    fireEvent.click(screen.getByTestId("close"));
    expect(screen.getByTestId("is-open")).toHaveTextContent("closed");
  });

  it("throws when used outside provider", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      "useAIAssistantContext must be used within AIAssistantProvider"
    );
    consoleError.mockRestore();
  });
});
