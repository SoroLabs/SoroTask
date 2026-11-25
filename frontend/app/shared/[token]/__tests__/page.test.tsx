import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SharedPage from "../page";

jest.mock("next/navigation", () => ({
  useParams: () => ({ token: "test-session-token" }),
}));

describe("SharedPage Collaboration (Issue #1518)", () => {
  it("renders collaborative workspace with peer presence and draft editor", () => {
    render(<SharedPage />);

    expect(
      screen.getByText("Team Workspace Collaborative Editing"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Session Token: test-session-token/i),
    ).toBeInTheDocument();
    expect(screen.getByText("WebRTC P2P Data Channel")).toBeInTheDocument();
    expect(screen.getByTestId("draft-title-input")).toBeInTheDocument();
  });

  it("allows editing draft title and co-signing draft", async () => {
    render(<SharedPage />);

    const titleInput = screen.getByTestId(
      "draft-title-input",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, {
      target: { value: "New Team Automation Flow" },
    });
    expect(titleInput.value).toBe("New Team Automation Flow");

    const coSignBtn = screen.getByTestId("co-sign-btn");
    fireEvent.click(coSignBtn);

    await waitFor(() => {
      expect(screen.getByText(/Status: co_signed/i)).toBeInTheDocument();
    });
  });

  it("allows toggling between WebRTC and WebSocket transport", () => {
    render(<SharedPage />);

    const modeBtn = screen.getByText("WebRTC P2P Data Channel");
    fireEvent.click(modeBtn);

    expect(
      screen.getByText("WebSocket Transport (Fallback)"),
    ).toBeInTheDocument();
  });
});
