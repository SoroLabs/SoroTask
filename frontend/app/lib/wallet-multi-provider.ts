import type { WalletProvider, WalletProviderType } from "./wallet-provider";
import type { WalletSession } from "./wallet";

export type MultiProviderStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface MultiProviderState {
  status: MultiProviderStatus;
  session: WalletSession | null;
  activeProvider: WalletProviderType | null;
  error: string | null;
}

export class WalletMultiProvider {
  private providers: Map<WalletProviderType, WalletProvider> = new Map();
  private stopWatcher: (() => void) | null = null;
  private onStateChange: (state: MultiProviderState) => void;
  private state: MultiProviderState = {
    status: "idle",
    session: null,
    activeProvider: null,
    error: null,
  };

  constructor(onStateChange: (state: MultiProviderState) => void) {
    this.onStateChange = onStateChange;
  }

  register(provider: WalletProvider): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: WalletProviderType): WalletProvider | undefined {
    return this.providers.get(id);
  }

  async getAvailableProviders(): Promise<WalletProviderType[]> {
    const checks = await Promise.allSettled(
      [...this.providers.entries()].map(async ([id, p]) => {
        const ok = await p.isAvailable();
        return ok ? id : null;
      }),
    );
    return checks
      .filter((r) => r.status === "fulfilled" && r.value !== null)
      .map((r) => (r as PromiseFulfilledResult<WalletProviderType>).value);
  }

  async connect(providerId: WalletProviderType): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      this.setState({ status: "error", error: `Provider "${providerId}" is not registered.`, session: null, activeProvider: null });
      return;
    }

    this.setState({ status: "connecting", error: null, session: this.state.session, activeProvider: this.state.activeProvider });

    try {
      const result = await provider.connect();
      const session: WalletSession = {
        address: result.address,
        network: {
          network: result.network,
          networkUrl: result.networkUrl,
          networkPassphrase: result.networkPassphrase,
          sorobanRpcUrl: result.sorobanRpcUrl,
        },
      };

      this.stopWatcher?.();
      this.stopWatcher = provider.watchChanges((address) => {
        if (!address) {
          this.setState({ status: "disconnected", session: null, activeProvider: null, error: null });
          this.stopWatcher = null;
        } else {
          this.setState({ ...this.state, session: { ...session, address } });
        }
      });

      this.setState({ status: "connected", session, activeProvider: providerId, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ status: "error", error: msg, session: null, activeProvider: null });
    }
  }

  async disconnect(): Promise<void> {
    this.stopWatcher?.();
    this.stopWatcher = null;

    if (this.state.activeProvider) {
      const provider = this.providers.get(this.state.activeProvider);
      await provider?.disconnect().catch(() => undefined);
    }

    this.setState({ status: "disconnected", session: null, activeProvider: null, error: null });
  }

  destroy(): void {
    this.stopWatcher?.();
    this.stopWatcher = null;
  }

  private setState(partial: MultiProviderState): void {
    this.state = partial;
    this.onStateChange(this.state);
  }
}
