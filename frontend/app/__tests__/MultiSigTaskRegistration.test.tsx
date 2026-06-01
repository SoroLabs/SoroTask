import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock @stellar/freighter-api
jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
  getNetworkDetails: jest.fn(),
  signTransaction: jest.fn(),
  WatchWalletChanges: jest.fn().mockImplementation(() => ({
    watch: jest.fn(),
    stop: jest.fn(),
  })),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// 1. Mock useWallet
import { useWallet } from "@/app/context/WalletContext";
jest.mock("@/app/context/WalletContext", () => ({
  useWallet: jest.fn(),
}));

// 2. Mock SorobanService
import { SorobanService } from "@/app/lib/soroban.service";
jest.mock("@/app/lib/soroban.service", () => {
  return {
    SorobanService: jest.fn().mockImplementation(() => ({
      executeContractCall: jest.fn(),
    })),
  };
});

// Import domain logic
import {
  validateDraft,
  createProposal,
  addApproval,
  canExecute,
  saveProposals,
  loadProposals,
  deleteProposal,
  type ProposalDraft,
  type TaskProposal,
} from "../lib/multisig";

// Import components and hooks
import { useMultiSigRegistration } from "../hooks/useMultiSigRegistration";
import { MultiSigTaskRegistration } from "../components/MultiSigTaskRegistration";

describe("MultiSig Task Registration - Domain Logic (multisig.ts)", () => {
  const validDraft: ProposalDraft = {
    contractAddress: "CC12345678901234567890",
    functionName: "harvest_yield",
    intervalSeconds: 3600,
    gasBalanceXlm: 10,
    requiredSigners: ["GB1", "GB2"],
    threshold: 2,
  };

  it("validates draft inputs correctly", () => {
    // Valid draft
    expect(validateDraft(validDraft)).toEqual([]);

    // Missing contract address
    expect(validateDraft({ ...validDraft, contractAddress: "" })).toContain(
      "Contract address is required."
    );

    // Invalid contract address
    expect(validateDraft({ ...validDraft, contractAddress: "ABCD" })).toContain(
      "Contract address must be a valid Stellar contract ID starting with \"C\"."
    );

    // Missing function name
    expect(validateDraft({ ...validDraft, functionName: "" })).toContain(
      "Function name is required."
    );

    // Invalid function name characters/cases
    expect(validateDraft({ ...validDraft, functionName: "Harvest" })).toContain(
      "Function name must start with a lowercase letter and contain only lowercase letters, numbers, and underscores."
    );

    // Invalid interval
    expect(validateDraft({ ...validDraft, intervalSeconds: 30 })).toContain(
      "Interval must be at least 60 seconds."
    );

    // Invalid gas
    expect(validateDraft({ ...validDraft, gasBalanceXlm: 0.05 })).toContain(
      "Gas balance must be at least 0.1 XLM."
    );

    // Empty signers
    expect(validateDraft({ ...validDraft, requiredSigners: [] })).toContain(
      "At least one required signer must be specified."
    );

    // Invalid threshold
    expect(validateDraft({ ...validDraft, threshold: 0 })).toContain(
      "Threshold must be between 1 and 2."
    );
    expect(validateDraft({ ...validDraft, threshold: 3 })).toContain(
      "Threshold must be between 1 and 2."
    );
  });

  it("creates a proposal correctly", () => {
    const proposer = "GB1";
    const proposal = createProposal(validDraft, proposer);

    expect(proposal.id).toBeDefined();
    expect(proposal.contractAddress).toBe(validDraft.contractAddress);
    expect(proposal.functionName).toBe(validDraft.functionName);
    expect(proposal.intervalSeconds).toBe(validDraft.intervalSeconds);
    expect(proposal.gasBalanceXlm).toBe(validDraft.gasBalanceXlm);
    expect(proposal.status).toBe("pending_approvals");
    // Proposer is in requiredSigners, so auto-approved
    expect(proposal.approvals).toHaveLength(1);
    expect(proposal.approvals[0].signer).toBe(proposer);
  });

  it("creates proposal ready when threshold is 1 and proposer approves", () => {
    const proposer = "GB1";
    const draftOneSig = { ...validDraft, threshold: 1 };
    const proposal = createProposal(draftOneSig, proposer);
    expect(proposal.status).toBe("ready");
  });

  it("manages approvals and status promotion", () => {
    const proposer = "GB1";
    let proposal = createProposal(validDraft, proposer);

    // Non-signer tries to approve
    expect(() => addApproval(proposal, "GB_STRANGER")).toThrow(
      /is not a required signer/
    );

    // Approve by valid signer
    proposal = addApproval(proposal, "GB2");
    expect(proposal.approvals).toHaveLength(2);
    expect(proposal.status).toBe("ready");

    // Already approved signer tries to approve again
    expect(() => addApproval(proposal, "GB2")).toThrow(
      /has already approved/
    );
  });

  it("canExecute helper works", () => {
    const proposer = "GB1";
    let proposal = createProposal(validDraft, proposer);
    expect(canExecute(proposal)).toBe(false);

    proposal = addApproval(proposal, "GB2");
    expect(canExecute(proposal)).toBe(true);

    proposal.status = "executed";
    expect(canExecute(proposal)).toBe(false);
  });

  it("manages localStorage persistence safely", () => {
    const list: TaskProposal[] = [
      {
        id: "1",
        contractAddress: "C1",
        functionName: "f",
        intervalSeconds: 60,
        gasBalanceXlm: 1,
        requiredSigners: ["G1"],
        threshold: 1,
        approvals: [],
        status: "pending_approvals",
        proposedBy: "G1",
        proposedAt: Date.now(),
      },
    ];

    saveProposals(list);
    expect(localStorageMock.setItem).toHaveBeenCalled();

    const loaded = loadProposals();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("1");

    // Test deleteProposal
    const afterDelete = deleteProposal(list, "1");
    expect(afterDelete).toHaveLength(0);
  });
});

describe("MultiSig Task Registration - Hook (useMultiSigRegistration.ts)", () => {
  const mockWallet = useWallet as jest.Mock;

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it("initializes and proposed tasks", () => {
    mockWallet.mockReturnValue({
      session: {
        address: "GB1",
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    expect(hookResult.proposals).toEqual([]);

    // Propose
    act(() => {
      hookResult.proposeTask({
        contractAddress: "CC12345678901234567890",
        functionName: "harvest",
        intervalSeconds: 3600,
        gasBalanceXlm: 10,
        requiredSigners: ["GB1", "GB2"],
        threshold: 2,
      });
    });

    expect(hookResult.proposals).toHaveLength(1);
    expect(hookResult.proposals[0].functionName).toBe("harvest");
  });

  it("handles approvals and double-approval prevention via hook", () => {
    mockWallet.mockReturnValue({
      session: {
        address: "GB2",
      },
    });

    const mockProposal: TaskProposal = {
      id: "test-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1", "GB2"],
      threshold: 2,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "pending_approvals",
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    saveProposals([mockProposal]);

    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    // Check load
    expect(hookResult.proposals).toHaveLength(1);

    // Approve
    act(() => {
      hookResult.approveProposal("test-id");
    });

    expect(hookResult.proposals[0].approvals).toHaveLength(2);
    expect(hookResult.proposals[0].status).toBe("ready");

    // Double approve error check
    act(() => {
      hookResult.approveProposal("test-id");
    });
    expect(hookResult.error).toContain("has already approved");

    // Clear error
    act(() => {
      hookResult.dismissError();
    });
    expect(hookResult.error).toBeNull();
  });

  it("handles execution path with SorobanService correctly", async () => {
    const mockExecute = jest.fn().mockResolvedValue({ txHash: "mocked-tx-hash" });
    (SorobanService as jest.Mock).mockImplementation(() => ({
      executeContractCall: mockExecute,
    }));

    mockWallet.mockReturnValue({
      session: {
        address: "GB1",
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    const mockProposal: TaskProposal = {
      id: "ready-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1"],
      threshold: 1,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "ready",
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    saveProposals([mockProposal]);

    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    await act(async () => {
      await hookResult.executeProposal("ready-id");
    });

    expect(mockExecute).toHaveBeenCalledWith({
      publicKey: "GB1",
      contractId: "CC12345678901234567890",
      method: "harvest",
      args: [],
      networkPassphrase: "mock-passphrase",
    });

    expect(hookResult.proposals[0].status).toBe("executed");
    expect(hookResult.proposals[0].txHash).toBe("mocked-tx-hash");
  });

  it("handles execution failure gracefully", async () => {
    (SorobanService as jest.Mock).mockImplementation(() => ({
      executeContractCall: jest.fn().mockRejectedValue(new Error("RPC Error")),
    }));

    mockWallet.mockReturnValue({
      session: {
        address: "GB1",
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    const mockProposal: TaskProposal = {
      id: "ready-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1"],
      threshold: 1,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "ready",
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    saveProposals([mockProposal]);

    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    await act(async () => {
      await hookResult.executeProposal("ready-id");
    });

    expect(hookResult.proposals[0].status).toBe("failed");
    expect(hookResult.error).toBe("RPC Error");
  });
});

describe("MultiSigTaskRegistration UI Component", () => {
  const mockWallet = useWallet as jest.Mock;

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it("gates component via WalletGate when wallet is disconnected", () => {
    mockWallet.mockReturnValue({
      status: "disconnected",
      connect: jest.fn(),
      isLoading: false,
    });

    render(<MultiSigTaskRegistration />);
    expect(screen.getByText(/Connect your Freighter wallet to create or approve/)).toBeInTheDocument();
  });

  it("renders form and manages client validation and proposal submission", async () => {
    mockWallet.mockReturnValue({
      status: "connected",
      session: {
        address: "GB1",
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    render(<MultiSigTaskRegistration />);

    // Check main title
    expect(screen.getByText("Multi-Sig Task Registration")).toBeInTheDocument();

    // Fill the form
    fireEvent.change(screen.getByLabelText(/Target Contract Address/i), {
      target: { value: "CC1234567890" },
    });
    fireEvent.change(screen.getByLabelText(/Function Name/i), {
      target: { value: "my_harvest" },
    });
    fireEvent.change(screen.getByLabelText(/Interval/i), {
      target: { value: "3600" },
    });
    fireEvent.change(screen.getByLabelText(/Gas Balance/i), {
      target: { value: "25" },
    });

    // Add co-signer
    act(() => {
      fireEvent.change(screen.getByPlaceholderText(/Wallet address/i), {
        target: { value: "GB_COSIGNER" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add signer" }));
    });

    // Try adding duplicate signer to cover line 110-112
    act(() => {
      fireEvent.change(screen.getByPlaceholderText(/Wallet address/i), {
        target: { value: "GB_COSIGNER" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add signer" }));
    });
    expect(screen.getAllByText(/This address is already in the signer list/i)[0]).toBeInTheDocument();

    // Remove signer to cover line 119
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Remove signer GB_COSIGNER/i }));
    });

    // Threshold selector should have 1 option now
    const thresholdSelect = screen.getByLabelText(/Approval Threshold/i);
    expect(thresholdSelect).toBeInTheDocument();
    act(() => {
      fireEvent.change(thresholdSelect, { target: { value: "1" } });
    });

    // Submit
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Create Proposal/i }));
    });

    // Verify view switches to Active Proposals panel
    await waitFor(() => {
      expect(screen.getByText("Active Proposals")).toBeInTheDocument();
    });
  });

  it("handles client side validation errors in form submission", async () => {
    mockWallet.mockReturnValue({
      status: "connected",
      session: {
        address: "GB1",
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    render(<MultiSigTaskRegistration />);

    // Click submit with empty form to trigger validation error
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Create Proposal/i }));
    });
    
    // Check form error banner
    expect(screen.getAllByText("Contract address is required.")[0]).toBeInTheDocument();

    // Dismiss error to cover lines 160-165
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Dismiss error/i }));
    });
    expect(screen.queryByText("Contract address is required.")).not.toBeInTheDocument();
  });
});

describe("MultiSig Extra Domain and Hook Coverage Tests", () => {
  const mockWallet = useWallet as jest.Mock;

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it("covers addApproval non-pending status error", () => {
    const p: TaskProposal = {
      id: "ready-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1", "GB2"],
      threshold: 2,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "ready", // ready, not pending_approvals
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    expect(() => addApproval(p, "GB2")).toThrow(/Cannot approve a proposal with status "ready"/);
  });

  it("covers saveProposals quota errors", () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error("Quota exceeded");
    });
    // Should not crash
    expect(() => saveProposals([])).not.toThrow();
  });

  it("covers loadProposals parse errors", () => {
    localStorageMock.getItem.mockReturnValueOnce("invalid-json{");
    expect(loadProposals()).toEqual([]);
  });

  it("covers proposeTask error when disconnected", () => {
    mockWallet.mockReturnValue({ session: null });
    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    act(() => {
      hookResult.proposeTask({
        contractAddress: "CC12345678901234567890",
        functionName: "harvest",
        intervalSeconds: 3600,
        gasBalanceXlm: 10,
        requiredSigners: ["GB1"],
        threshold: 1,
      });
    });
    expect(hookResult.error).toContain("Connect your wallet before creating a proposal");
  });

  it("covers proposeTask validation error when invalid", () => {
    mockWallet.mockReturnValue({ session: { address: "GB1" } });
    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    act(() => {
      hookResult.proposeTask({
        contractAddress: "", // invalid
        functionName: "harvest",
        intervalSeconds: 3600,
        gasBalanceXlm: 10,
        requiredSigners: ["GB1"],
        threshold: 1,
      });
    });
    expect(hookResult.error).toContain("Contract address is required");
  });

  it("covers approveProposal error when disconnected", () => {
    mockWallet.mockReturnValue({ session: null });
    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    act(() => {
      hookResult.approveProposal("some-id");
    });
    expect(hookResult.error).toContain("Connect your wallet to approve this proposal");
  });

  it("covers executeProposal error when disconnected", async () => {
    mockWallet.mockReturnValue({ session: null });
    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    await act(async () => {
      await hookResult.executeProposal("some-id");
    });
    expect(hookResult.error).toContain("Connect your wallet to execute this proposal");
  });

  it("covers executeProposal error when not ready", async () => {
    mockWallet.mockReturnValue({ session: { address: "GB1" } });
    const mockProposal: TaskProposal = {
      id: "pending-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1", "GB2"],
      threshold: 2,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "pending_approvals", // not ready
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    saveProposals([mockProposal]);

    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    await act(async () => {
      await hookResult.executeProposal("pending-id");
    });
    expect(hookResult.error).toContain("Proposal is not ready for execution");
  });

  it("covers executeProposal txHash fallback and removeProposal", async () => {
    const mockExecute = jest.fn().mockResolvedValue({ hash: "fallback-hash" });
    (SorobanService as jest.Mock).mockImplementation(() => ({
      executeContractCall: mockExecute,
    }));

    mockWallet.mockReturnValue({
      session: {
        address: "GB1",
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    const mockProposal: TaskProposal = {
      id: "ready-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1"],
      threshold: 1,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "ready",
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    saveProposals([mockProposal]);

    let hookResult: any;
    function TestComponent() {
      hookResult = useMultiSigRegistration();
      return null;
    }
    render(<TestComponent />);

    await act(async () => {
      await hookResult.executeProposal("ready-id");
    });

    expect(hookResult.proposals[0].txHash).toBe("fallback-hash");

    // Test removeProposal
    act(() => {
      hookResult.removeProposal("ready-id");
    });
    expect(hookResult.proposals).toHaveLength(0);
  });

  it("covers ProposalCard button clicks and renders list correctly", async () => {
    mockWallet.mockReturnValue({
      status: "connected",
      session: {
        address: "GB2", // connected as a co-signer
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    const mockProposal: TaskProposal = {
      id: "pending-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1", "GB2"],
      threshold: 2,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "pending_approvals",
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    saveProposals([mockProposal]);

    render(<MultiSigTaskRegistration />);

    // Switch to Active Proposals tab
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /Active Proposals/i }));
    });

    // Check that card renders details
    expect(screen.getByText("harvest")).toBeInTheDocument();

    // Connected user is GB2 (hasn't approved yet), click Approve
    const approveBtn = screen.getByRole("button", { name: /Approve proposal pending-id/i });
    expect(approveBtn).toBeInTheDocument();
    act(() => {
      fireEvent.click(approveBtn);
    });

    // Click Remove proposal
    const removeBtn = screen.getByRole("button", { name: /Remove proposal pending-id/i });
    expect(removeBtn).toBeInTheDocument();
    act(() => {
      fireEvent.click(removeBtn);
    });
  });

  it("covers execute button on ready proposal", async () => {
    const mockExecute = jest.fn().mockResolvedValue({ txHash: "mocked-tx-hash" });
    (SorobanService as jest.Mock).mockImplementation(() => ({
      executeContractCall: mockExecute,
    }));

    mockWallet.mockReturnValue({
      status: "connected",
      session: {
        address: "GB1",
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    const mockProposal: TaskProposal = {
      id: "ready-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1"],
      threshold: 1,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "ready",
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    saveProposals([mockProposal]);

    render(<MultiSigTaskRegistration />);

    // Switch to Active Proposals tab
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /Active Proposals/i }));
    });

    // Click Execute
    const executeBtn = screen.getByRole("button", { name: /Execute proposal ready-id/i });
    expect(executeBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(executeBtn);
    });
  });
});


// ---------------------------------------------------------------------------
// Branch-coverage gap tests (new validation paths)
// ---------------------------------------------------------------------------
describe("MultiSig Branch Coverage Gap Tests", () => {
  const mockWallet = useWallet as jest.Mock;

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  // multisig.ts L109-110: validateDraft rejects an invalid signer address
  it("validateDraft rejects an invalid signer address format", () => {
    const errors = validateDraft({
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["NOT_A_STELLAR_ADDRESS!"],
      threshold: 1,
    });
    expect(errors).toContain(
      "Invalid signer address format: NOT_A_STELLAR_ADDRESS!. Must be a valid Stellar address."
    );
  });

  // MultiSigTaskRegistration.tsx L113-115: addSigner rejects invalid address via UI
  it("UI addSigner shows error for invalid signer address format", () => {
    mockWallet.mockReturnValue({
      status: "connected",
      session: {
        address: "GB1",
        network: {
          sorobanRpcUrl: "https://rpc.mock",
          networkPassphrase: "mock-passphrase",
        },
      },
    });

    render(<MultiSigTaskRegistration />);

    act(() => {
      fireEvent.change(screen.getByPlaceholderText(/Wallet address/i), {
        target: { value: "NOT!VALID" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add signer" }));
    });

    expect(
      screen.getByText(/Signer must be a valid Stellar public key/i)
    ).toBeInTheDocument();
  });

  // MultiSigTaskRegistration.tsx L379: connectedAddress === undefined (ternary false branch)
  it("ProposalCard renders correctly when connectedAddress is undefined", () => {
    mockWallet.mockReturnValue({
      status: "connected",
      session: undefined,
    });

    const mockProposal: TaskProposal = {
      id: "pending-id",
      contractAddress: "CC12345678901234567890",
      functionName: "harvest",
      intervalSeconds: 3600,
      gasBalanceXlm: 10,
      requiredSigners: ["GB1", "GB2"],
      threshold: 2,
      approvals: [{ signer: "GB1", approvedAt: Date.now() }],
      status: "pending_approvals",
      proposedBy: "GB1",
      proposedAt: Date.now(),
    };
    saveProposals([mockProposal]);

    render(<MultiSigTaskRegistration />);

    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /Active Proposals/i }));
    });

    expect(screen.getByText("harvest")).toBeInTheDocument();
    // Approve button must not appear when connectedAddress is undefined
    expect(
      screen.queryByRole("button", { name: /Approve proposal pending-id/i })
    ).not.toBeInTheDocument();
  });
});
