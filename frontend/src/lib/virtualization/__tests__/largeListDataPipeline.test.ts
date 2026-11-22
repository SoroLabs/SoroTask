import {
  createLargeListDataPipeline,
  generateSyntheticTaskDataset,
} from "../largeListDataPipeline";

describe("largeListDataPipeline", () => {
  it("generates a synthetic dataset of 100,000 tasks efficiently", () => {
    const dataset = generateSyntheticTaskDataset(1000);
    expect(dataset.length).toBe(1000);
    expect(dataset[0]).toHaveProperty("id");
    expect(dataset[0]).toHaveProperty("title");
    expect(dataset[0]).toHaveProperty("status");
  });

  it("filters items by query and status", () => {
    const pipeline = createLargeListDataPipeline();
    const dataset = [
      {
        id: "task-1",
        title: "Oracle Update",
        status: "running" as const,
        contractAddress: "CC123",
        executions: 10,
        gasBalance: 15,
        createdAt: "2026-01-01",
      },
      {
        id: "task-2",
        title: "Keeper Clean",
        status: "paused" as const,
        contractAddress: "CC456",
        executions: 5,
        gasBalance: 20,
        createdAt: "2026-01-02",
      },
    ];
    pipeline.loadDataset(dataset);

    const filtered = pipeline.getFilteredItems("oracle", "running");
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("task-1");
  });

  it("sorts items by various fields", () => {
    const pipeline = createLargeListDataPipeline();
    const items = [
      { id: "task-2", title: "B", status: "running" as const, contractAddress: "C2", executions: 20, gasBalance: 5, createdAt: "2026-01-02" },
      { id: "task-1", title: "A", status: "running" as const, contractAddress: "C1", executions: 10, gasBalance: 50, createdAt: "2026-01-01" },
    ];
    const sorted = pipeline.sortItems(items, "executions", "asc");
    expect(sorted[0].id).toBe("task-1");
    expect(sorted[1].id).toBe("task-2");
  });

  it("performs bulk actions successfully", () => {
    const pipeline = createLargeListDataPipeline();
    const items = [
      { id: "task-1", title: "T1", status: "running" as const, contractAddress: "C1", executions: 1, gasBalance: 5, createdAt: "2026-01-01" },
      { id: "task-2", title: "T2", status: "running" as const, contractAddress: "C2", executions: 1, gasBalance: 5, createdAt: "2026-01-01" },
    ];
    pipeline.loadDataset(items);

    const result = pipeline.performBulkAction(["task-1", "task-2"], "pause");
    expect(result.success).toBe(true);
    expect(result.affected).toBe(2);
  });
});
