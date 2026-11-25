import {
  buildLifecycleBatch,
  buildRefillBatch,
  buildBatchOps,
} from "../batchOps";

describe("batchOps", () => {
  it("maps a batch pause to one pause_task op per selected task", () => {
    expect(buildLifecycleBatch(["task-1", "task-2", "task-3"], "pause")).toEqual([
      { taskId: "task-1", method: "pause_task" },
      { taskId: "task-2", method: "pause_task" },
      { taskId: "task-3", method: "pause_task" },
    ]);
  });

  it("maps resume and cancel to their contract methods", () => {
    expect(buildLifecycleBatch(["42"], "resume")).toEqual([
      { taskId: "42", method: "resume_task" },
    ]);
    expect(buildLifecycleBatch(["42"], "cancel")).toEqual([
      { taskId: "42", method: "cancel_task" },
    ]);
  });

  it("maps a batch refill to one deposit_gas op per task", () => {
    expect(buildRefillBatch(["1", "2", "1"])).toEqual([
      { taskId: "1", method: "deposit_gas" },
      { taskId: "2", method: "deposit_gas" },
    ]);
  });

  it("deduplicates repeated task ids so the atomic tx stays small", () => {
    expect(buildBatchOps(["a", "a", "b"], "pause")).toHaveLength(2);
    expect(buildBatchOps(["a", "a", "b"], "pause")).toEqual([
      { taskId: "a", method: "pause_task" },
      { taskId: "b", method: "pause_task" },
    ]);
  });

  it("routes refill through the deposit_gas builder", () => {
    expect(buildBatchOps(["7"], "refill")).toEqual([
      { taskId: "7", method: "deposit_gas" },
    ]);
  });

  it("returns an empty batch for no selection", () => {
    expect(buildBatchOps([], "cancel")).toEqual([]);
  });
});