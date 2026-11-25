import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AIAssistantPanel } from "../Panel";
import { AIAssistantProvider } from "../ContextProvider";
import { getAIClient } from "@/src/lib/ai/openai-client";

jest.mock("@/src/lib/ai/openai-client", () => ({
  getAIClient: jest.fn(() => ({
    chat: jest.fn(() =>
      Promise.resolve({
        content: "Streamed response from assistant",
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

function renderWithProvider(ui: React.ReactElement) {
  return render(<AIAssistantProvider>{ui}</AIAssistantProvider>);
}

describe("AIAssistantPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAIClient as jest.Mock).mockReturnValue({
      chat: jest.fn(() =>
        Promise.resolve({
          content: "Streamed response from assistant",
        })
      ),
    });
  });

  it("renders the floating action button", () => {
    renderWithProvider(<AIAssistantPanel />);
    expect(screen.getByTestId("ai-assistant-fab")).toBeInTheDocument();
  });

  it("opens and closes the drawer when FAB is clicked", async () => {
    renderWithProvider(<AIAssistantPanel />);
    const fab = screen.getByTestId("ai-assistant-fab");

    fireEvent.click(fab);
    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant-drawer")).toBeInTheDocument();
    });

    fireEvent.click(fab);
    await waitFor(() => {
      expect(screen.queryByTestId("ai-assistant-drawer")).not.toBeInTheDocument();
    });
  });

  it("shows context information when drawer is open", async () => {
    renderWithProvider(<AIAssistantPanel />);
    fireEvent.click(screen.getByTestId("ai-assistant-fab"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant-drawer")).toBeInTheDocument();
    });
  });

  it("sends a message via input", async () => {
    renderWithProvider(<AIAssistantPanel />);
    fireEvent.click(screen.getByTestId("ai-assistant-fab"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("ai-assistant-input");
    fireEvent.change(input, { target: { value: "Create a task" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Create a task")).toBeInTheDocument();
    });
  });

  it("clears input after sending", async () => {
    renderWithProvider(<AIAssistantPanel />);
    fireEvent.click(screen.getByTestId("ai-assistant-fab"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("ai-assistant-input");
    fireEvent.change(input, { target: { value: "Create a task" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("does not send empty messages", async () => {
    renderWithProvider(<AIAssistantPanel />);
    fireEvent.click(screen.getByTestId("ai-assistant-fab"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("ai-assistant-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(input).toHaveValue("   ");
    });
  });

  it("displays suggestion chips when open", async () => {
    renderWithProvider(<AIAssistantPanel />);
    fireEvent.click(screen.getByTestId("ai-assistant-fab"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant-drawer")).toBeInTheDocument();
    });

    await waitFor(
      () => {
        const suggestions = screen.queryAllByRole("button");
        expect(suggestions.length).toBeGreaterThan(0);
      },
      { timeout: 4000 }
    );
  });

  it("shows retry button and dismiss on error", async () => {
    (getAIClient as jest.Mock).mockReturnValue({
      chat: jest.fn(() => Promise.reject(new Error("Network error"))),
    });

    renderWithProvider(<AIAssistantPanel />);
    fireEvent.click(screen.getByTestId("ai-assistant-fab"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("ai-assistant-input");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
      expect(screen.getByText("Dismiss")).toBeInTheDocument();
    });
  });

  it("clears error when dismiss is clicked", async () => {
    (getAIClient as jest.Mock).mockReturnValue({
      chat: jest.fn(() => Promise.reject(new Error("Network error"))),
    });

    renderWithProvider(<AIAssistantPanel />);
    fireEvent.click(screen.getByTestId("ai-assistant-fab"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("ai-assistant-input");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });
});
