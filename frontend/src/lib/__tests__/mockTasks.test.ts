import { generateMockTasks } from "../mockTasks";

describe("generateMockTasks", () => {
  it("generates the requested number of tasks", () => {
    expect(generateMockTasks(0)).toHaveLength(0);
    expect(generateMockTasks(1)).toHaveLength(1);
    expect(generateMockTasks(10_000)).toHaveLength(10_000);
  });

  it("is deterministic for a given seed", () => {
    const a = generateMockTasks(50, 42);
    const b = generateMockTasks(50, 42);
    expect(a).toEqual(b);
  });

  it("produces different output for different seeds", () => {
    const a = generateMockTasks(50, 1);
    const b = generateMockTasks(50, 2);
    expect(a).not.toEqual(b);
  });

  it("assigns unique, padded ids", () => {
    const tasks = generateMockTasks(1_000);
    const ids = new Set(tasks.map((t) => t.id));
    expect(ids.size).toBe(1_000);
    expect(tasks[0].id).toMatch(/^task-\d{6}$/);
  });

  it("populates required fields on every task", () => {
    const tasks = generateMockTasks(20);
    for (const t of tasks) {
      expect(t.title).toBeTruthy();
      expect(t.contract.startsWith("C")).toBe(true);
      expect(t.contract.length).toBe(56);
      expect(t.fn).toBeTruthy();
      expect(t.intervalSec).toBeGreaterThan(0);
      expect(t.gas).toBeGreaterThanOrEqual(0);
      expect(["pending", "running", "success", "failed"]).toContain(t.status);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});
