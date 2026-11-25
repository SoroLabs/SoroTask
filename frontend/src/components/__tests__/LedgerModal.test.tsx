import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LedgerModal } from "../LedgerModal";

describe("LedgerModal", () => {
  it("renders modal with WebHID / WebUSB options and BIP-44 path selector", () => {
    const handleClose = jest.fn();
    const handleConnected = jest.fn();

    render(
      <LedgerModal
        isOpen={true}
        onClose={handleClose}
        onConnected={handleConnected}
      />,
    );

    expect(screen.getByText("Ledger Hardware Wallet")).toBeInTheDocument();
    expect(screen.getByText("WebHID")).toBeInTheDocument();
    expect(screen.getByText("WebUSB")).toBeInTheDocument();
    expect(
      screen.getByText(/Blind-Signing Safety Warning/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Zero Private Key Exposure/i)).toBeInTheDocument();
    expect(screen.getByText(/BIP-44 Derivation Path/i)).toBeInTheDocument();
  });

  it("switches protocols when clicked", () => {
    render(
      <LedgerModal isOpen={true} onClose={jest.fn()} onConnected={jest.fn()} />,
    );

    const usbBtn = screen.getByText("WebUSB");
    fireEvent.click(usbBtn);
    expect(usbBtn).toHaveClass("bg-blue-600");
  });

  it("calls onClose when Cancel is clicked", () => {
    const handleClose = jest.fn();
    render(
      <LedgerModal
        isOpen={true}
        onClose={handleClose}
        onConnected={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
