import { taskKeys } from "../keys";

describe("taskKeys", () => {
  it("returns a stable, hierarchical structure for invalidation", () => {
    expect(taskKeys.all).toEqual(["tasks"]);
    expect(taskKeys.lists()).toEqual(["tasks", "list"]);
    expect(taskKeys.list()).toEqual(["tasks", "list", {}]);
    expect(taskKeys.list({ status: "pending" })).toEqual([
      "tasks",
      "list",
      { status: "pending" },
    ]);
    expect(taskKeys.details()).toEqual(["tasks", "detail"]);
    expect(taskKeys.detail("abc")).toEqual(["tasks", "detail", "abc"]);
  });

  it("treats different filter objects as different keys", () => {
    expect(taskKeys.list({ status: "pending" })).not.toEqual(
      taskKeys.list({ status: "running" }),
    );
    expect(taskKeys.list({ status: "pending" })).not.toEqual(
      taskKeys.list({ search: "harvest" }),
    );
  });

  it("nests every key beneath taskKeys.all so a top-level invalidation hits everything", () => {
    const candidates = [
      taskKeys.lists(),
      taskKeys.list({ status: "pending" }),
      taskKeys.details(),
      taskKeys.detail("abc"),
    ];
    for (const k of candidates) {
      expect(k.slice(0, taskKeys.all.length)).toEqual(taskKeys.all);
    }
  });
});
