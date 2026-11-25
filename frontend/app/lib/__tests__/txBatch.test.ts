import {
  buildRegistrationBatch,
  type TaskRegistrationDraft,
} from "../txBatch";

const validRow = (id: string): TaskRegistrationDraft => ({
  id,
  contractAddress: "CABC123",
  functionName: "harvest",
  intervalSeconds: 3600,
  gasBalance: "10",
});

describe("txBatch", () => {
  it("builds a batch from valid drafts", () => {
    const batch = buildRegistrationBatch([validRow("1"), validRow("2")]);
    expect(batch.operationCount).toBe(2);
    expect(batch.estimatedFeeStroops).toBe(200);
  });

  it("rejects empty batches", () => {
    expect(() =>
      buildRegistrationBatch([
        {
          id: "1",
          contractAddress: "",
          functionName: "",
          intervalSeconds: 0,
          gasBalance: "",
        },
      ]),
    ).toThrow(/at least one valid/);
  });

  it("rejects oversized batches", () => {
    const rows = Array.from({ length: 21 }, (_, i) => validRow(String(i)));
    expect(() => buildRegistrationBatch(rows)).toThrow(/limited to 20/);
  });
});
