import { act } from "@testing-library/react";
import { useTaskStore } from "../taskStore";
import type { Task } from "@/src/types/task";

function makeTask(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  act(() => useTaskStore.getState().reset());
});

// ── setDependencies ───────────────────────────────────────────────────────────

describe("setDependencies", () => {
  it("replaces the dependency list", () => {
    act(() =>
      useTaskStore.getState().setDependencies([{ fromId: "a", toId: "b" }])
    );
    expect(useTaskStore.getState().dependencies).toHaveLength(1);
  });

  it("clears dependencies when called with empty array", () => {
    act(() =>
      useTaskStore.getState().setDependencies([{ fromId: "a", toId: "b" }])
    );
    act(() => useTaskStore.getState().setDependencies([]));
    expect(useTaskStore.getState().dependencies).toHaveLength(0);
  });
});

// ── addDependency ─────────────────────────────────────────────────────────────

describe("addDependency", () => {
  beforeEach(() => {
    act(() => {
      useTaskStore.getState().setTasks([
        makeTask("a"),
        makeTask("b"),
        makeTask("c"),
      ]);
    });
  });

  it("adds a valid dependency and returns null", () => {
    let result: string | null = "not-called";
    act(() => {
      result = useTaskStore.getState().addDependency("a", "b");
    });
    expect(result).toBeNull();
    expect(useTaskStore.getState().dependencies).toHaveLength(1);
    expect(useTaskStore.getState().dependencies[0]).toEqual({
      fromId: "a",
      toId: "b",
    });
  });

  it("rejects self-dependency and returns error string", () => {
    let result: string | null = null;
    act(() => {
      result = useTaskStore.getState().addDependency("a", "a");
    });
    expect(result).toMatch(/itself/i);
    expect(useTaskStore.getState().dependencies).toHaveLength(0);
  });

  it("rejects duplicate dependency", () => {
    act(() => useTaskStore.getState().addDependency("a", "b"));
    let result: string | null = null;
    act(() => {
      result = useTaskStore.getState().addDependency("a", "b");
    });
    expect(result).toMatch(/already exists/i);
    expect(useTaskStore.getState().dependencies).toHaveLength(1);
  });

  it("rejects a cycle and returns error string", () => {
    act(() => useTaskStore.getState().addDependency("a", "b"));
    act(() => useTaskStore.getState().addDependency("b", "c"));
    let result: string | null = null;
    act(() => {
      result = useTaskStore.getState().addDependency("c", "a");
    });
    expect(result).toMatch(/cycle/i);
    expect(useTaskStore.getState().dependencies).toHaveLength(2);
  });

  it("allows a chain a→b→c", () => {
    act(() => useTaskStore.getState().addDependency("a", "b"));
    act(() => useTaskStore.getState().addDependency("b", "c"));
    expect(useTaskStore.getState().dependencies).toHaveLength(2);
  });
});

// ── removeDependency ──────────────────────────────────────────────────────────

describe("removeDependency", () => {
  beforeEach(() => {
    act(() => {
      useTaskStore.getState().setDependencies([
        { fromId: "a", toId: "b" },
        { fromId: "b", toId: "c" },
      ]);
    });
  });

  it("removes the matching dependency", () => {
    act(() => useTaskStore.getState().removeDependency("a", "b"));
    expect(useTaskStore.getState().dependencies).toHaveLength(1);
    expect(useTaskStore.getState().dependencies[0]).toEqual({
      fromId: "b",
      toId: "c",
    });
  });

  it("is a no-op for a non-existent dependency", () => {
    act(() => useTaskStore.getState().removeDependency("x", "y"));
    expect(useTaskStore.getState().dependencies).toHaveLength(2);
  });

  it("does not remove the reverse direction", () => {
    act(() => useTaskStore.getState().removeDependency("b", "a")); // reversed
    expect(useTaskStore.getState().dependencies).toHaveLength(2);
  });
});

// ── reset clears dependencies ─────────────────────────────────────────────────

describe("reset", () => {
  it("clears dependencies", () => {
    act(() =>
      useTaskStore.getState().setDependencies([{ fromId: "a", toId: "b" }])
    );
    act(() => useTaskStore.getState().reset());
    expect(useTaskStore.getState().dependencies).toHaveLength(0);
  });
});
