import * as Sentry from "../errors/sentry";

export interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  serviceName: "frontend" | "api-gateway" | "keeper-resolver" | "soroban-rpc" | "ledger";
  startTime: number; // timestamp ms
  endTime?: number;
  status: "success" | "error" | "pending";
  tags: Record<string, string | number | boolean>;
  errorMessage?: string;
}

export interface Trace {
  traceId: string;
  spans: Span[];
}

/**
 * TracingClient tracks transaction events from frontend wallet signatures
 * through API gateways and keepers to ledger commits.
 */
class TracingClient {
  private activeTraces = new Map<string, Trace>();
  private traceHistory: Trace[] = [];

  constructor() {
    this.loadHistory();
  }

  private loadHistory() {
    // Start with default mock trace runs for UI demo completeness
    const mockTraceId = "tr_harvest_091k8";
    const startTime = Date.now() - 3600000;

    const mockSpans: Span[] = [
      {
        id: "span_wallet_sign",
        traceId: mockTraceId,
        name: "Sign Transact Proposal",
        serviceName: "frontend",
        startTime,
        endTime: startTime + 850,
        status: "success",
        tags: { "wallet.provider": "Freighter", "wallet.address": "G...3JK" },
      },
      {
        id: "span_api_gateway",
        traceId: mockTraceId,
        parentId: "span_wallet_sign",
        name: "POST /v1/tasks/harvest",
        serviceName: "api-gateway",
        startTime: startTime + 850,
        endTime: startTime + 1050,
        status: "success",
        tags: { "http.status": 202, "client.ip": "127.0.0.1" },
      },
      {
        id: "span_keeper_resolve",
        traceId: mockTraceId,
        parentId: "span_api_gateway",
        name: "Trigger Execution Resolver",
        serviceName: "keeper-resolver",
        startTime: startTime + 1050,
        endTime: startTime + 2100,
        status: "success",
        tags: { "keeper.id": "node_east_03", "resolver.trigger": "cron_scheduler" },
      },
      {
        id: "span_soroban_rpc",
        traceId: mockTraceId,
        parentId: "span_keeper_resolve",
        name: "Simulate & Send Transaction",
        serviceName: "soroban-rpc",
        startTime: startTime + 1100,
        endTime: startTime + 1800,
        status: "success",
        tags: { "rpc.method": "sendTransaction", "rpc.endpoint": "https://mainnet.stellar.org" },
      },
      {
        id: "span_ledger_commit",
        traceId: mockTraceId,
        parentId: "span_soroban_rpc",
        name: "Ledger Close Consensus Commit",
        serviceName: "ledger",
        startTime: startTime + 1800,
        endTime: startTime + 2080,
        status: "success",
        tags: { "ledger.sequence": 1042405, "gas.charged": 3400 },
      },
    ];

    this.traceHistory.push({ traceId: mockTraceId, spans: mockSpans });
  }

  public getHistory(): Trace[] {
    return this.traceHistory;
  }

  public startTrace(traceId: string): Trace {
    const trace = { traceId, spans: [] };
    this.activeTraces.set(traceId, trace);
    return trace;
  }

  public startSpan(spanConfig: Omit<Span, "startTime" | "status" | "tags"> & { tags?: Record<string, string | number | boolean> }): Span {
    const trace = this.activeTraces.get(spanConfig.traceId) || this.startTrace(spanConfig.traceId);
    
    const newSpan: Span = {
      ...spanConfig,
      startTime: Date.now(),
      status: "pending",
      tags: spanConfig.tags || {},
    };

    trace.spans.push(newSpan);
    return newSpan;
  }

  public finishSpan(traceId: string, spanId: string, status: "success" | "error", tags?: Record<string, string | number | boolean>, errorMsg?: string) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find((s) => s.id === spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.status = status;
    if (tags) {
      span.tags = { ...span.tags, ...tags };
    }

    if (status === "error") {
      span.errorMessage = errorMsg || "Span execution encountered an unhandled error";
      this.reportErrorToSentry(span);
    }

    // If root span finishes and all spans in trace are done, save to history
    const allFinished = trace.spans.every((s) => s.status !== "pending");
    if (allFinished && !this.traceHistory.some((t) => t.traceId === traceId)) {
      this.traceHistory.unshift({ ...trace });
      this.activeTraces.delete(traceId);
    }
  }

  private reportErrorToSentry(span: Span) {
    // Log breadcrumb context for Sentry trace tracking integration
    Sentry.addSentryBreadcrumb("tracing", `Span error encountered: ${span.name}`, {
      spanId: span.id,
      traceId: span.traceId,
      service: span.serviceName,
      errorMessage: span.errorMessage,
    });

    // Capture standard exception
    Sentry.captureSentryException(new Error(`[Tracing Service Error] ${span.name}: ${span.errorMessage}`));
  }

  public clearHistory() {
    this.traceHistory = [];
  }
}

export const tracingClient = new TracingClient();
export default tracingClient;
