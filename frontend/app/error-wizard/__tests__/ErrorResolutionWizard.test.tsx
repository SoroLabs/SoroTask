import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorResolutionWizard } from "../components/ErrorResolutionWizard";

const mockOpenConnectModal = jest.fn();

jest.mock("@/app/context/WalletContext", () => ({
  useWalletOptional: () => ({
    openConnectModal: mockOpenConnectModal,
  }),
}));

describe("ErrorResolutionWizard recovery actions", () => {
  beforeEach(() => {
    mockOpenConnectModal.mockClear();
  });

  it("opens the wallet panel when the user applies a reconnect recovery", () => {
    render(<ErrorResolutionWizard />);

    fireEvent.change(screen.getByRole("textbox", { name: "Paste failure logs JSON" }), {
      target: {
        value: JSON.stringify([
          {
            taskId: "task-1",
            timestamp: "2026-10-17T00:00:00.000Z",
            errorCode: "TX_BAD_AUTH",
            errorMessage: "bad auth",
          },
        ]),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze logs" }));
    fireEvent.click(screen.getByRole("button", { name: /Open wallet/ }));

    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Wallet panel opened");
    expect(screen.getByRole("region", { name: /Step 1 of 1/ })).toBeInTheDocument();
  });

  it("decodes hex diagnostic input in the wizard", () => {
    const diagnostic = "Error(Contract, #2)";
    const hex = `0x${Array.from(new TextEncoder().encode(diagnostic), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;

    render(<ErrorResolutionWizard />);
    fireEvent.change(screen.getByRole("textbox", { name: "Soroban diagnostic payload" }), {
      target: { value: hex },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decode diagnostic" }));

    expect(screen.getByText(/custom error #2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Decoded hex diagnostic/));
    expect(screen.getByText(diagnostic)).toBeInTheDocument();
  });
});
