import {
  REDACTED,
  scrubString,
  scrubUrl,
  scrubValue,
} from "@/src/lib/observability/scrubber";

export interface DiagnosticReport {
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "bug" | "ui" | "transaction" | "performance" | "other";
  walletAddress?: string;
  browser: {
    userAgent: string;
    language: string;
    url: string;
    timestamp: string;
    screenResolution?: string;
    onlineStatus: boolean;
  };
  consoleLogs: string[];
  networkErrors: Array<{
    url: string;
    status: number;
    error: string;
    timestamp: number;
  }>;
  ticketDestination?: "github" | "jira" | "api";
}

const ADDRESS_PATTERN = /(?<![A-Z2-7])[GC][A-Z2-7]{55}(?![A-Z2-7])/g;
const BALANCE_PATTERN =
  /\b(?:balance|amount|gas|funds)\b(?:\s*(?:is|of|:|=))?\s*(?:[$]?\s*)\d+(?:[.,]\d+)*(?:\s*(?:xlm|stroops?))?/gi;
const SENSITIVE_FIELD_PATTERN =
  /wallet|address|balance|amount|gas|funds|private|secret|token|password|mnemonic|seed|api[_-]?key/i;
const MAX_HISTORY = 50;

function scrubDiagnosticString(value: string): string {
  return scrubString(value)
    .replace(ADDRESS_PATTERN, REDACTED)
    .replace(BALANCE_PATTERN, REDACTED)
    .replace(
      /((?:private[_-]?key|secret(?:[_-]?(?:key|token))?|api[_-]?key|auth[_-]?token|seed|mnemonic|password|bearer|authorization)\s*[:=]\s*)[^\s,;&]+/gi,
      `$1${REDACTED}`,
    )
    .replace(/TOP_SECRET_[^\s,;&]+/gi, REDACTED);
}

function scrubDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === "string") return scrubDiagnosticString(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubDiagnosticValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key)
          ? REDACTED
          : /url/i.test(key) && typeof entry === "string"
            ? scrubDiagnosticString(scrubUrl(entry))
            : scrubDiagnosticValue(entry, depth + 1),
      ]),
    );
  }
  return scrubValue(value);
}

export class Telemetry {
  private static instance: Telemetry;
  private readonly consoleHistory: string[] = [];
  private readonly networkErrorsHistory: DiagnosticReport["networkErrors"] = [];

  private constructor() {}

  static getInstance(): Telemetry {
    if (!Telemetry.instance) Telemetry.instance = new Telemetry();
    return Telemetry.instance;
  }

  initialize(): () => void {
    if (typeof window === "undefined") return () => undefined;

    const onError = (event: ErrorEvent) => {
      this.recordConsole(
        "ERROR",
        [event.message || "Unknown client error"],
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      this.recordConsole("UNHANDLED_REJECTION", [
        event.reason instanceof Error ? event.reason.message : String(event.reason),
      ]);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }

  recordConsole(level: string, args: unknown[]): void {
    const message = scrubDiagnosticString(
      `[${level}] ${args
        .map((arg) =>
          typeof arg === "string"
            ? arg
            : JSON.stringify(scrubDiagnosticValue(arg)),
        )
        .join(" ")}`,
    );
    this.consoleHistory.push(message);
    if (this.consoleHistory.length > MAX_HISTORY) this.consoleHistory.shift();
  }

  recordNetworkError(url: string, status: number, error: string): void {
    this.networkErrorsHistory.push({
      url: scrubUrl(url.split(/[?#]/, 1)[0]).replace(ADDRESS_PATTERN, REDACTED),
      status,
      error: scrubDiagnosticString(error),
      timestamp: Date.now(),
    });
    if (this.networkErrorsHistory.length > MAX_HISTORY) {
      this.networkErrorsHistory.shift();
    }
  }

  captureConsoleSnapshot(maxLogs = 50): string[] {
    return this.consoleHistory.slice(-Math.max(0, maxLogs));
  }

  captureNetworkErrors(): DiagnosticReport["networkErrors"] {
    return this.networkErrorsHistory.map((item) => ({ ...item }));
  }

  redactSensitiveData(report: DiagnosticReport): DiagnosticReport {
    return scrubDiagnosticValue(report) as DiagnosticReport;
  }

  async sendReport(
    report: DiagnosticReport,
  ): Promise<{ success: boolean; ticketId?: string; error?: string }> {
    try {
      const sanitized = this.redactSensitiveData(report);
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitized),
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      const data = (await response.json()) as { ticketId?: string };
      return {
        success: true,
        ticketId:
          data.ticketId ??
          `TICK-${Date.now().toString(36).toUpperCase()}`,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to submit diagnostic report",
      };
    }
  }
}

export const telemetry = Telemetry.getInstance();
