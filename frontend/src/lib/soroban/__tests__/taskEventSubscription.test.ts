import {
  SorobanTaskEventSubscription,
  getTaskEventSubscription,
  parseTaskChainEvent,
} from "../taskEventSubscription";

jest.mock("@stellar/stellar-sdk", () => ({
  scValToNative: (scVal: any) => scVal.__native,
}));

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn().mockImplementation(() => ({
    getEvents: jest.fn(),
    getLatestLedger: jest.fn(),
  })),
}));

function fakeScVal(native: unknown) {
  return { __native: native } as any;
}

function fakeEvent(overrides: Partial<any> = {}) {
  return {
    id: "evt-1",
    type: "contract",
    ledger: 100,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: "tx-hash-1",
    topic: [fakeScVal("task_executed"), fakeScVal("42")],
    value: fakeScVal({ gasUsed: 100 }),
    ...overrides,
  };
}

describe("parseTaskChainEvent", () => {
  it("decodes a recognized event into a TaskChainEvent", () => {
    const parsed = parseTaskChainEvent(fakeEvent());
    expect(parsed).toMatchObject({
      taskId: "42",
      eventType: "task_executed",
      txHash: "tx-hash-1",
      ledger: 100,
      inSuccessfulContractCall: true,
      payload: { gasUsed: 100 },
    });
  });

  it("maps an unrecognized topic name to 'unknown' rather than dropping it", () => {
    const parsed = parseTaskChainEvent(
      fakeEvent({ topic: [fakeScVal("some_other_event"), fakeScVal("7")] }),
    );
    expect(parsed?.eventType).toBe("unknown");
    expect(parsed?.taskId).toBe("7");
  });

  it("returns null when the event carries no task id", () => {
    const parsed = parseTaskChainEvent(fakeEvent({ topic: [fakeScVal("task_executed")] }));
    expect(parsed).toBeNull();
  });

  it("returns null and does not throw when decoding fails", () => {
    const badEvent = fakeEvent();
    badEvent.topic = [
      {
        get __native() {
          throw new Error("boom");
        },
      },
    ] as any;
    expect(parseTaskChainEvent(badEvent)).toBeNull();
  });
});

describe("SorobanTaskEventSubscription", () => {
  let getEvents: jest.Mock;
  let getLatestLedger: jest.Mock;
  let subscription: SorobanTaskEventSubscription;

  beforeEach(() => {
    jest.useFakeTimers();
    getEvents = jest.fn().mockResolvedValue({ events: [], cursor: "cursor-1", latestLedger: 200 });
    getLatestLedger = jest.fn().mockResolvedValue({ sequence: 200 });

    subscription = new SorobanTaskEventSubscription({
      contractId: "CCONTRACT",
      pollIntervalMs: 1000,
    });
    (subscription as any).server = { getEvents, getLatestLedger };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not poll before a consumer acquires it", () => {
    expect(getEvents).not.toHaveBeenCalled();
  });

  it("polls immediately once a consumer acquires, using the latest ledger to seed the range", async () => {
    subscription.acquire();
    await jest.runOnlyPendingTimersAsync();

    expect(getLatestLedger).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ type: "contract", contractIds: ["CCONTRACT"] }],
        startLedger: 195,
      }),
    );
  });

  it("emits a parsed event for each raw event returned by getEvents", async () => {
    getEvents.mockResolvedValueOnce({ events: [fakeEvent()], cursor: "cursor-2", latestLedger: 201 });
    const handler = jest.fn();
    subscription.on("event", handler);

    subscription.acquire();
    await jest.runOnlyPendingTimersAsync();

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ taskId: "42", eventType: "task_executed" }));
  });

  it("switches to cursor-based pagination after the first poll", async () => {
    subscription.acquire();
    await jest.runOnlyPendingTimersAsync();
    getEvents.mockClear();

    await jest.advanceTimersByTimeAsync(1000);

    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-1" }),
    );
    expect(getLatestLedger).toHaveBeenCalledTimes(1);
  });

  it("stops polling once every consumer has released", async () => {
    subscription.acquire();
    await jest.runOnlyPendingTimersAsync();
    getEvents.mockClear();

    subscription.release();
    await jest.advanceTimersByTimeAsync(5000);

    expect(getEvents).not.toHaveBeenCalled();
  });

  it("keeps polling for a second consumer after the first releases", async () => {
    subscription.acquire();
    subscription.acquire();
    await jest.runOnlyPendingTimersAsync();
    getEvents.mockClear();

    subscription.release();
    await jest.advanceTimersByTimeAsync(1000);

    expect(getEvents).toHaveBeenCalled();
  });

  it("emits an error and keeps the poll loop alive when getEvents rejects", async () => {
    getEvents.mockRejectedValueOnce(new Error("rpc down"));
    const errorHandler = jest.fn();
    subscription.on("error", errorHandler);

    subscription.acquire();
    await jest.runOnlyPendingTimersAsync();

    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));

    getEvents.mockResolvedValueOnce({ events: [], cursor: "cursor-3", latestLedger: 202 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(getEvents).toHaveBeenCalledTimes(2);
  });
});

describe("getTaskEventSubscription", () => {
  it("returns the same instance for the same contract + rpc url", () => {
    const a = getTaskEventSubscription({ contractId: "CSAME", rpcUrl: "https://rpc.example" });
    const b = getTaskEventSubscription({ contractId: "CSAME", rpcUrl: "https://rpc.example" });
    expect(a).toBe(b);
  });

  it("returns a different instance for a different contract", () => {
    const a = getTaskEventSubscription({ contractId: "CONE", rpcUrl: "https://rpc.example" });
    const b = getTaskEventSubscription({ contractId: "CTWO", rpcUrl: "https://rpc.example" });
    expect(a).not.toBe(b);
  });
});
