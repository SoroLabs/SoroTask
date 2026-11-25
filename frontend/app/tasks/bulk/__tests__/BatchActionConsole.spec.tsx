import { fireEvent, render, screen } from "@testing-library/react";
import BatchActionConsole from "../BatchActionConsole";
import { useTaskBulkSelection } from "../bulkSelectionStore";
import { NETWORKS } from "@/src/lib/network/config";

const futurenetContractId = NETWORKS.futurenet.contractId;

jest.mock("@/app/context/WalletContext", () => ({
  useWalletOptional: jest.fn(),
}));

const { useWalletOptional } = jest.requireMock("@/app/context/WalletContext");

const mockPause = jest.fn();
const mockResume = jest.fn();
const mockCancel = jest.fn();
const mockRefill = jest.fn();

jest.mock("@/src/hooks/tasks", () => ({
  useBatchPauseTasks: jest.fn(() => ({
    mutate: mockPause,
    isPending: false,
    error: null,
  })),
  useBatchResumeTasks: jest.fn(() => ({
    mutate: mockResume,
    isPending: false,
    error: null,
  })),
  useBatchCancelTasks: jest.fn(() => ({
    mutate: mockCancel,
    isPending: false,
    error: null,
  })),
  useBatchRefillTasks: jest.fn(() => ({
    mutate: mockRefill,
    isPending: false,
    error: null,
  })),
}));

function select(ids: string[]) {
  useTaskBulkSelection.getState().setSelection(ids);
}

function resetSelection() {
  useTaskBulkSelection.getState().clear();
}

describe("BatchActionConsole (#1265)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSelection();
    (useWalletOptional as jest.Mock).mockReturnValue({
      status: "disconnected",
      session: null,
    });
    jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders disabled actions and no signature note when nothing is selected", () => {
    render(<BatchActionConsole />);

    expect(screen.getByText("0 tasks selected")).toBeInTheDocument();
    expect(screen.getByTestId("batch-pause")).toBeDisabled();
    expect(screen.getByTestId("batch-resume")).toBeDisabled();
    expect(screen.getByTestId("batch-cancel")).toBeDisabled();
    expect(screen.getByTestId("batch-refill")).toBeDisabled();
    expect(screen.queryByTestId("batch-signature-note")).not.toBeInTheDocument();
  });

  it("shows the single-signature note for the selected tasks", () => {
    select(["1", "2"]);
    render(<BatchActionConsole />);

    expect(screen.getByText("2 tasks selected")).toBeInTheDocument();
    expect(screen.getByTestId("batch-signature-note")).toHaveTextContent(
      "2 operations · 1 wallet signature",
    );
  });

  it("fires a batch pause mutation with a single signature context", () => {
    select(["task-1", "task-2"]);
    render(<BatchActionConsole />);

    fireEvent.click(screen.getByTestId("batch-pause"));

    expect(mockPause).toHaveBeenCalledWith({
      taskIds: ["task-1", "task-2"],
      userAddress: undefined,
      contractId: futurenetContractId,
    });
  });

  it("passes the connected wallet address along with the network's contractId", () => {
    (useWalletOptional as jest.Mock).mockReturnValue({
      status: "connected",
      session: {
        address: "GBR...ADDR",
        network: {
          networkPassphrase: "Test SDF Future Network ; October 2022",
        },
      },
    });
    select(["1"]);
    render(<BatchActionConsole />);

    fireEvent.click(screen.getByTestId("batch-resume"));

    expect(mockResume).toHaveBeenCalledWith({
      taskIds: ["1"],
      userAddress: "GBR...ADDR",
      contractId: futurenetContractId,
    });
  });

  it("refills the batch with one deposit_gas op per selected task", () => {
    select(["1", "3"]);
    render(<BatchActionConsole />);

    fireEvent.click(screen.getByTestId("batch-refill"));

    // Default amount is 1 XLM = 10_000_000 stroops.
    expect(mockRefill).toHaveBeenCalledWith({
      taskIds: ["1", "3"],
      amount: 10000000n,
      userAddress: undefined,
      contractId: futurenetContractId,
    });
  });

  it("disables refill and surfaces an error for an invalid amount", () => {
    select(["1"]);
    render(<BatchActionConsole />);

    fireEvent.change(screen.getByTestId("batch-refill-amount"), {
      target: { value: "not-a-number" },
    });

    expect(screen.getByTestId("batch-refill")).toBeDisabled();
    expect(screen.getByText(/Refill:/)).toBeInTheDocument();
  });

  it("requires confirmation before batch cancel", () => {
    (window.confirm as jest.Mock).mockReturnValue(false);

    select(["1"]);
    render(<BatchActionConsole />);

    fireEvent.click(screen.getByTestId("batch-cancel"));
    expect(mockCancel).not.toHaveBeenCalled();

    (window.confirm as jest.Mock).mockReturnValue(true);
    fireEvent.click(screen.getByTestId("batch-cancel"));
    expect(mockCancel).toHaveBeenCalledWith({
      taskIds: ["1"],
      userAddress: undefined,
      contractId: futurenetContractId,
    });
  });

  it("renders chips for the selected tasks when task data is available", () => {
    select(["t1"]);
    render(
      <BatchActionConsole
        tasks={[{ id: "t1", contract: "C", fn: "rebalance", intervalSec: 60, gas: 5, status: "running", updatedAt: 0 }]}
      />,
    );

    expect(screen.getByTestId("batch-chip")).toHaveTextContent("t1");
  });
});