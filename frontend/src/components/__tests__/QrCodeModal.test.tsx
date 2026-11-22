import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QrCodeModal } from "../QrCodeModal";
import { splitPayloadIntoUrFrames } from "@/src/lib/qrProtocol";

describe("QrCodeModal (Issue #1517)", () => {
  it("renders QR code modal with animated multipart frames", () => {
    const payload = "A".repeat(250);
    render(
      <QrCodeModal
        isOpen={true}
        onClose={jest.fn()}
        transactionXdr={payload}
        title="Air-Gapped Mobile Signing"
      />,
    );

    expect(screen.getByText("Air-Gapped Mobile Signing")).toBeInTheDocument();
    expect(screen.getByTestId("qr-svg-container")).toBeInTheDocument();
    expect(screen.getByText(/Checksum:/i)).toBeInTheDocument();
  });

  it("allows manual frame ingestion and completes reassembly", async () => {
    const onScanComplete = jest.fn();
    const payload = "TEST_SIGNATURE_PAYLOAD_XDR_DATA_STRING";
    const frames = splitPayloadIntoUrFrames(payload, 15);

    render(
      <QrCodeModal
        isOpen={true}
        onClose={jest.fn()}
        transactionXdr={payload}
        onScanComplete={onScanComplete}
      />,
    );

    // Switch to scan tab
    fireEvent.click(screen.getByText(/2. Scan Signed Signature/i));

    const input = screen.getByTestId("qr-frame-input");
    const submitBtn = screen.getByText("Ingest Frame");

    for (const frame of frames) {
      fireEvent.change(input, { target: { value: frame.urString } });
      fireEvent.click(submitBtn);
    }

    await waitFor(() => {
      expect(screen.getByTestId("scan-status-banner")).toHaveTextContent(
        "All parts reassembled & verified!",
      );
    });

    expect(onScanComplete).toHaveBeenCalledWith(payload);
  });
});
