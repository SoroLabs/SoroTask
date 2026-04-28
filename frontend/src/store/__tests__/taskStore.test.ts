import { act } from "@testing-library/react";
import {
  useTaskStore,
  selectTaskList,
  selectSelectedTask,
} from "../taskStore";
import type { Task, TaskContent } from "@/src/types/task";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTask(id: string, title = `Task ${id}`): Task {
  return {
    id,
    title,
    description: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

const richContent: TaskContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "hello" }] },
  ],
};

// Reset store before every test so tests are fully isolated
beforeEach(() => {
  act(() => {
    useTaskStore.getState().reset();
  });
});

// ── setTasks ──────────────────────────────────────────────────────────────────

describe("setTasks", () => {
  it("populates tasks and taskIds", () => {
    const tasks = [makeTask("1"), makeTask("2")];
    act(() => useTaskStore.getState().setTasks(tasks));
    const state = useTaskStore.getState();
    expect(Object.keys(state.tasks)).toHaveLength(2);
    expect(state.taskIds).toEqual(["1", "2"]);
  });

  it("replaces existing tasks", () => {
    act(() => useTaskStore.getState().setTasks([makeTask("1")]));
    act(() => useTaskStore.getState().setTasks([makeTask("2"), makeTask("3")]));
    const state = useTaskStore.getState();
    expect(state.taskIds).toEqual(["2", "3"]);
    expect(state.tasks["1"]).toBeUndefined();
  });

  it("clears error on setTasks", () => {
    act(() => useTaskStore.getState().setError("oops"));
    act(() => useTaskStore.getState().setTasks([]));
    expect(useTaskStore.getState().error).toBeNull();
  });

  it("handles empty array", () => {
    act(() => useTaskStore.getState().setTasks([]));
    expect(useTaskStore.getState().taskIds).toHaveLength(0);
  });
});

// ── addTask ───────────────────────────────────────────────────────────────────

describe("addTask", () => {
  it("adds a task to the store", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    expect(useTaskStore.getState().tasks["1"]).toBeDefined();
    expect(useTaskStore.getState().taskIds).toContain("1");
  });

  it("is idempotent — does not duplicate on second add", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    expect(useTaskStore.getState().taskIds).toHaveLength(1);
  });

  it("preserves insertion order", () => {
    act(() => useTaskStore.getState().addTask(makeTask("a")));
    act(() => useTaskStore.getState().addTask(makeTask("b")));
    act(() => useTaskStore.getState().addTask(makeTask("c")));
    expect(useTaskStore.getState().taskIds).toEqual(["a", "b", "c"]);
  });
});

// ── updateTask ────────────────────────────────────────────────────────────────

describe("updateTask", () => {
  it("updates the title of an existing task", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1", "Old")));
    act(() => useTaskStore.getState().updateTask("1", { title: "New" }));
    expect(useTaskStore.getState().tasks["1"].title).toBe("New");
  });

  it("updates updatedAt timestamp", () => {
    const before = new Date("2024-01-01").toISOString();
    act(() =>
      useTaskStore.getState().addTask({ ...makeTask("1"), updatedAt: before })
    );
    act(() => useTaskStore.getState().updateTask("1", { title: "Changed" }));
    expect(useTaskStore.getState().tasks["1"].updatedAt).not.toBe(before);
  });

  it("is a no-op for unknown id", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    act(() => useTaskStore.getState().updateTask("999", { title: "Ghost" }));
    expect(useTaskStore.getState().tasks["999"]).toBeUndefined();
  });

  it("does not mutate other tasks", () => {
    act(() => useTaskStore.getState().setTasks([makeTask("1"), makeTask("2")]));
    act(() => useTaskStore.getState().updateTask("1", { title: "Changed" }));
    expect(useTaskStore.getState().tasks["2"].title).toBe("Task 2");
  });
});

// ── updateTaskDescription ─────────────────────────────────────────────────────

describe("updateTaskDescription", () => {
  it("sets the description on a task", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    act(() =>
      useTaskStore.getState().updateTaskDescription("1", richContent)
    );
    expect(useTaskStore.getState().tasks["1"].description).toEqual(richContent);
  });

  it("updates updatedAt when description changes", () => {
    const before = "2024-01-01T00:00:00Z";
    act(() =>
      useTaskStore.getState().addTask({ ...makeTask("1"), updatedAt: before })
    );
    act(() =>
      useTaskStore.getState().updateTaskDescription("1", richContent)
    );
    expect(useTaskStore.getState().tasks["1"].updatedAt).not.toBe(before);
  });

  it("is a no-op for unknown id", () => {
    act(() =>
      useTaskStore.getState().updateTaskDescription("ghost", richContent)
    );
    expect(useTaskStore.getState().tasks["ghost"]).toBeUndefined();
  });
});

// ── removeTask ────────────────────────────────────────────────────────────────

describe("removeTask", () => {
  it("removes a task from tasks and taskIds", () => {
    act(() => useTaskStore.getState().setTasks([makeTask("1"), makeTask("2")]));
    act(() => useTaskStore.getState().removeTask("1"));
    expect(useTaskStore.getState().tasks["1"]).toBeUndefined();
    expect(useTaskStore.getState().taskIds).not.toContain("1");
  });

  it("clears selectedTaskId when the selected task is removed", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    act(() => useTaskStore.getState().selectTask("1"));
    act(() => useTaskStore.getState().removeTask("1"));
    expect(useTaskStore.getState().selectedTaskId).toBeNull();
  });

  it("does not clear selectedTaskId when a different task is removed", () => {
    act(() =>
      useTaskStore.getState().setTasks([makeTask("1"), makeTask("2")])
    );
    act(() => useTaskStore.getState().selectTask("1"));
    act(() => useTaskStore.getState().removeTask("2"));
    expect(useTaskStore.getState().selectedTaskId).toBe("1");
  });

  it("is a no-op for unknown id", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    act(() => useTaskStore.getState().removeTask("ghost"));
    expect(useTaskStore.getState().taskIds).toHaveLength(1);
  });
});

// ── selectTask ────────────────────────────────────────────────────────────────

describe("selectTask", () => {
  it("sets selectedTaskId", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    act(() => useTaskStore.getState().selectTask("1"));
    expect(useTaskStore.getState().selectedTaskId).toBe("1");
  });

  it("clears selection when called with null", () => {
    act(() => useTaskStore.getState().selectTask("1"));
    act(() => useTaskStore.getState().selectTask(null));
    expect(useTaskStore.getState().selectedTaskId).toBeNull();
  });
});

// ── status / error ────────────────────────────────────────────────────────────

describe("setStatus", () => {
  it("sets status to loading", () => {
    act(() => useTaskStore.getState().setStatus("loading"));
    expect(useTaskStore.getState().status).toBe("loading");
  });

  it("sets status to success", () => {
    act(() => useTaskStore.getState().setStatus("success"));
    expect(useTaskStore.getState().status).toBe("success");
  });

  it("sets status to error", () => {
    act(() => useTaskStore.getState().setStatus("error"));
    expect(useTaskStore.getState().status).toBe("error");
  });
});

describe("setError", () => {
  it("sets error message and status=error", () => {
    act(() => useTaskStore.getState().setError("Network failure"));
    const state = useTaskStore.getState();
    expect(state.error).toBe("Network failure");
    expect(state.status).toBe("error");
  });

  it("clears error and resets status to idle when called with null", () => {
    act(() => useTaskStore.getState().setError("oops"));
    act(() => useTaskStore.getState().setError(null));
    const state = useTaskStore.getState();
    expect(state.error).toBeNull();
    expect(state.status).toBe("idle");
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe("reset", () => {
  it("clears all state back to initial values", () => {
    act(() => {
      useTaskStore.getState().setTasks([makeTask("1"), makeTask("2")]);
      useTaskStore.getState().selectTask("1");
      useTaskStore.getState().setError("boom");
    });
    act(() => useTaskStore.getState().reset());
    const state = useTaskStore.getState();
    expect(state.taskIds).toHaveLength(0);
    expect(state.selectedTaskId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.status).toBe("idle");
  });
});

// ── selectors ─────────────────────────────────────────────────────────────────

describe("selectTaskList", () => {
  it("returns tasks in insertion order", () => {
    act(() =>
      useTaskStore.getState().setTasks([makeTask("a"), makeTask("b"), makeTask("c")])
    );
    const list = selectTaskList(useTaskStore.getState());
    expect(list.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("returns empty array when no tasks", () => {
    expect(selectTaskList(useTaskStore.getState())).toEqual([]);
  });

  it("reflects removal", () => {
    act(() =>
      useTaskStore.getState().setTasks([makeTask("1"), makeTask("2")])
    );
    act(() => useTaskStore.getState().removeTask("1"));
    const list = selectTaskList(useTaskStore.getState());
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("2");
  });
});

describe("selectSelectedTask", () => {
  it("returns the selected task", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    act(() => useTaskStore.getState().selectTask("1"));
    const task = selectSelectedTask(useTaskStore.getState());
    expect(task?.id).toBe("1");
  });

  it("returns null when nothing is selected", () => {
    expect(selectSelectedTask(useTaskStore.getState())).toBeNull();
  });

  it("returns null after the selected task is removed", () => {
    act(() => useTaskStore.getState().addTask(makeTask("1")));
    act(() => useTaskStore.getState().selectTask("1"));
    act(() => useTaskStore.getState().removeTask("1"));
    expect(selectSelectedTask(useTaskStore.getState())).toBeNull();
  });
});

// ── loading + error path integration ─────────────────────────────────────────

describe("loading and error path", () => {
  it("transitions: idle → loading → success", () => {
    const store = useTaskStore.getState();
    expect(store.status).toBe("idle");
    act(() => useTaskStore.getState().setStatus("loading"));
    expect(useTaskStore.getState().status).toBe("loading");
    act(() => {
      useTaskStore.getState().setTasks([makeTask("1")]);
      useTaskStore.getState().setStatus("success");
    });
    expect(useTaskStore.getState().status).toBe("success");
    expect(useTaskStore.getState().taskIds).toHaveLength(1);
  });

  it("transitions: idle → loading → error", () => {
    act(() => useTaskStore.getState().setStatus("loading"));
    act(() => useTaskStore.getState().setError("fetch failed"));
    const state = useTaskStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("fetch failed");
    expect(state.taskIds).toHaveLength(0);
  });
});
