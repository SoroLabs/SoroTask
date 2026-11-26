import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TokenomicsPage from "../page";
import {
  calculateBaseAprFromState,
  calculateDynamicApr,
  calculateLockupMultiplier,
  createDefaultVaultState,
  formatStakingNumber,
} from "@/app/tokenomics/lib/stakingVaultMath";
import { type StakingVaultState } from "@/app/tokenomics/hooks/useStakingVault";

jest.mock("@/app/tokenomics/hooks/useStakingVault", () => ({
  useStakingVault: jest.fn(),
}));

jest.mock("@/app/context/WalletContext", () => ({
  useWalletOptional: jest.fn(),
}));

import { useStakingVault } from "@/app/tokenomics/hooks/useStakingVault";
import { useWalletOptional } from "@/app/context/WalletContext";

const mockUseStakingVault = useStakingVault as jest.Mock;
const mockUseWalletOptional = useWalletOptional as jest.Mock;

const CONNECTED_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function createMockVault(
  overrides: Partial<StakingVaultState> = {},
): StakingVaultState {
  const state = createDefaultVaultState();
  const baseApr = calculateBaseAprFromState(state);
  return {
    isConnected: false,
    walletAddress: null,
    contractState: state,
    isSimulated: true,
    stakedXlm: state.totalStaked,
    claimableXlm: state.claimableXlm,
    activeUnstakes: state.activeUnstakes,
    baseApr,
    dynamicApr: calculateDynamicApr(state, 30),
    multiplier: calculateLockupMultiplier(30),
    projectedYieldXlm: 0,
    compoundProjection: state.totalStaked + state.claimableXlm,
    lockupDays: 30,
    setLockupDays: jest.fn(),
    isStaking: false,
    isCompounding: false,
    stakeError: null,
    compoundError: null,
    lastTxHash: null,
    refresh: jest.fn(),
    stake: jest.fn(),
    compoundStake: jest.fn(),
    ...overrides,
  };
}

function mockWallet(address: string | null) {
  mockUseWalletOptional.mockReturnValue({
    session: address ? { address } : null,
    openConnectModal: jest.fn(),
    status: address ? "connected" : "disconnected",
  });
}

describe("TokenomicsPage — Staking Vault", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet(null);
    mockUseStakingVault.mockReturnValue(createMockVault());
  });

  it("renders the Staking Vault section with dynamic APR metrics", () => {
    const vault = createMockVault();
    mockUseStakingVault.mockReturnValue(vault);

    render(<TokenomicsPage />);

    expect(
      screen.getByRole("heading", { name: /Staking Vault — Dynamic APR/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Tokenomics & Vesting Simulator" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(`${formatStakingNumber(vault.dynamicApr, 4)}%`)
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(`${vault.multiplier.toFixed(2)}x`).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(`${formatStakingNumber(vault.stakedXlm)} XLM`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${formatStakingNumber(vault.claimableXlm)} XLM`),
    ).toBeInTheDocument();
  });

  it("exposes an accessible lockup slider with aria attributes and quick presets", () => {
    mockUseStakingVault.mockReturnValue(createMockVault());

    render(<TokenomicsPage />);

    const slider = screen.getByRole("slider", {
      name: "Lockup duration in days",
    });
    expect(slider).toHaveAttribute("aria-valuemin", "1");
    expect(slider).toHaveAttribute("aria-valuemax", "365");
    expect(slider).toHaveAttribute("aria-valuenow", "30");
    expect(slider).toHaveAttribute("aria-valuetext", "30 days");
    expect(screen.getByText(/Live Preview/)).toBeInTheDocument();
  });

  it("snaps the slider via fireEvent and triggers setLockupDays", () => {
    const vault = createMockVault();
    mockUseStakingVault.mockReturnValue(vault);

    render(<TokenomicsPage />);

    fireEvent.change(
      screen.getByRole("slider", { name: "Lockup duration in days" }),
      {
        target: { value: "90" },
      },
    );
    expect(vault.setLockupDays).toHaveBeenCalledWith(90);
  });

  it("quick-select buttons call setLockupDays with the anchor day counts", () => {
    const vault = createMockVault();
    mockUseStakingVault.mockReturnValue(vault);

    render(<TokenomicsPage />);

    fireEvent.click(screen.getByTestId("lockup-preset-30d"));
    fireEvent.click(screen.getByTestId("lockup-preset-90d"));
    fireEvent.click(screen.getByTestId("lockup-preset-365d"));

    expect(vault.setLockupDays).toHaveBeenCalledWith(30);
    expect(vault.setLockupDays).toHaveBeenCalledWith(90);
    expect(vault.setLockupDays).toHaveBeenCalledWith(365);
  });

  it("renders a connected wallet address state when connected", () => {
    mockWallet(CONNECTED_ADDRESS);
    mockUseStakingVault.mockReturnValue(
      createMockVault({ isConnected: true, walletAddress: CONNECTED_ADDRESS }),
    );

    render(<TokenomicsPage />);

    expect(screen.getByTestId("connected-address").textContent).toContain(
      CONNECTED_ADDRESS.slice(0, 12),
    );
    expect(screen.queryByText("Connect Wallet")).not.toBeInTheDocument();
  });

  it("shows Connect Wallet and disabled actions when disconnected", () => {
    mockUseStakingVault.mockReturnValue(
      createMockVault({ isConnected: false }),
    );

    render(<TokenomicsPage />);

    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
    expect(screen.getByTestId("claim-rewards-button")).toBeDisabled();
    expect(screen.getByTestId("compound-button")).toBeDisabled();
    expect(screen.getByTestId("vault-stake-button")).toBeDisabled();
  });

  it("opens the RewardClaimModal when Claim Rewards is clicked", () => {
    mockUseStakingVault.mockReturnValue(
      createMockVault({ isConnected: true, walletAddress: CONNECTED_ADDRESS }),
    );

    render(<TokenomicsPage />);

    fireEvent.click(screen.getByTestId("claim-rewards-button"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("triggers the 1-click compound from the vault section", () => {
    const vault = createMockVault({
      isConnected: true,
      walletAddress: CONNECTED_ADDRESS,
    });
    mockUseStakingVault.mockReturnValue(vault);

    render(<TokenomicsPage />);

    fireEvent.click(screen.getByTestId("compound-button"));
    expect(vault.compoundStake).toHaveBeenCalled();
  });

  it("stake flow: enables the Stake button and calls vault.stake", () => {
    const vault = createMockVault({
      isConnected: true,
      walletAddress: CONNECTED_ADDRESS,
    });
    mockUseStakingVault.mockReturnValue(vault);

    render(<TokenomicsPage />);

    const input = screen.getByTestId("vault-stake-amount");
    const button = screen.getByTestId("vault-stake-button");
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "500" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(vault.stake).toHaveBeenCalledWith(500);
  });

  it("renders the unstaking timelock tracker from vault state", async () => {
    const vault = createMockVault({
      isConnected: true,
      walletAddress: CONNECTED_ADDRESS,
    });
    mockUseStakingVault.mockReturnValue(vault);

    render(<TokenomicsPage />);

    await waitFor(() =>
      expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0),
    );
  });
});
