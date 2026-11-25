import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ShareBadgeModal } from "../ShareBadgeModal";

describe("ShareBadgeModal Component", () => {
  const milestone = {
    taskId: "task-test-99",
    taskTitle: "1000 XLM Yield Compounding Milestone",
    executionsCount: 150,
    volumeAutomated: "1,500 XLM",
    gasSaved: "75.0 XLM",
    txHash: "7a8b9c...1234ef",
    completedAt: "2026-10-16",
  };

  it("renders credential badge with metrics and share triggers", () => {
    const mockClose = jest.fn();
    render(
      <ShareBadgeModal
        isOpen={true}
        onClose={mockClose}
        milestone={milestone}
      />,
    );

    expect(
      screen.getByText("Proof-of-Automation Credential"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1000 XLM Yield Compounding Milestone"),
    ).toBeInTheDocument();
    expect(screen.getByText("150 runs")).toBeInTheDocument();
    expect(screen.getByText("1,500 XLM")).toBeInTheDocument();
    expect(screen.getByText("75.0 XLM")).toBeInTheDocument();

    // Social share links exist
    const twitterLink = screen.getByTestId("share-twitter-btn");
    expect(twitterLink).toHaveAttribute("href");
    expect(twitterLink.getAttribute("href")).toContain(
      "twitter.com/intent/tweet",
    );

    const farcasterLink = screen.getByTestId("share-farcaster-btn");
    expect(farcasterLink).toHaveAttribute("href");
    expect(farcasterLink.getAttribute("href")).toContain("warpcast.com");
  });

  it("does not render when isOpen is false", () => {
    render(<ShareBadgeModal isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByTestId("share-badge-modal")).not.toBeInTheDocument();
  });
});
