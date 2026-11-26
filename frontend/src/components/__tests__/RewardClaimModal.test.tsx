import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RewardClaimModal } from "../RewardClaimModal";

describe("RewardClaimModal", () => {
  it("renders a dialog with aria-modal and a labelled title", () => {
    render(<RewardClaimModal isOpen onClose={jest.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText(/Reward & Gas Refund Claims Dashboard/),
    ).toBeInTheDocument();
  });

  it("closes on Escape key press", () => {
    const onClose = jest.fn();
    render(<RewardClaimModal isOpen onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the Close button", () => {
    const onClose = jest.fn();
    render(<RewardClaimModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(<RewardClaimModal isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("performs a 1-click claim and shows the success banner", async () => {
    const onClaimSuccess = jest.fn();
    const simulateBatchClaim = jest.fn(() => Promise.resolve());
    render(
      <RewardClaimModal
        isOpen
        onClose={jest.fn()}
        onClaimSuccess={onClaimSuccess}
        simulateBatchClaim={simulateBatchClaim}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Claim/ }));

    await waitFor(() => expect(simulateBatchClaim).toHaveBeenCalled());
    await waitFor(() => expect(onClaimSuccess).toHaveBeenCalled());
    expect((onClaimSuccess.mock.calls[0] as [number, string])[1]).toMatch(
      /tx_batch_claim_/,
    );
    expect(screen.getByText("Batch Claim Confirmed!")).toBeInTheDocument();
  });

  it("shows the claim error when the batch claim fails", async () => {
    const simulateBatchClaim = jest.fn(() =>
      Promise.reject(new Error("Claim transaction failed")),
    );
    render(
      <RewardClaimModal
        isOpen
        onClose={jest.fn()}
        simulateBatchClaim={simulateBatchClaim}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Claim/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Claim transaction failed",
      ),
    );
  });

  it("displays the projected compounded stake card", () => {
    render(
      <RewardClaimModal
        isOpen
        onClose={jest.fn()}
        compoundProjectionXlm={123.45}
      />,
    );

    expect(screen.getByText(/Projected Compounded Stake/)).toBeInTheDocument();
    expect(screen.getByText(/123\.45/)).toBeInTheDocument();
  });

  it("performs the 1-click compound and records the compound tx", async () => {
    const onCompound = jest.fn(() => Promise.resolve());
    render(
      <RewardClaimModal isOpen onClose={jest.fn()} onCompound={onCompound} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1-Click Compound" }));

    await waitFor(() => expect(onCompound).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByText(/Compound confirmed — claimable rewards re-staked/),
      ).toBeInTheDocument(),
    );
  });

  it("shows the compound error when the 1-click compound fails", async () => {
    const onCompound = jest.fn(() =>
      Promise.reject(new Error("Compound transaction failed")),
    );
    render(
      <RewardClaimModal isOpen onClose={jest.fn()} onCompound={onCompound} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1-Click Compound" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Compound transaction failed",
      ),
    );
  });
});
