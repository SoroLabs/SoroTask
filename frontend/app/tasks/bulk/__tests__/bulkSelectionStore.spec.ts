import {
  isBatchSelected,
  taskCheckboxLabel,
  useTaskBulkSelection,
} from "../bulkSelectionStore";

describe("useTaskBulkSelection (#1265 selection state)", () => {
  beforeEach(() => {
    useTaskBulkSelection.getState().clear();
  });

  it("toggles a single task in and out of the batch", () => {
    const store = useTaskBulkSelection.getState();
    store.toggle("task-1");
    expect(useTaskBulkSelection.getState().selectedIds).toEqual(["task-1"]);

    store.toggle("task-1");
    expect(useTaskBulkSelection.getState().selectedIds).toEqual([]);
  });

  it("selects and deselects many tasks at once (select-all)", () => {
    const store = useTaskBulkSelection.getState();
    store.selectMany(["1", "2", "3"], true);
    expect(useTaskBulkSelection.getState().selectedIds).toEqual(["1", "2", "3"]);

    store.selectMany(["2"], false);
    expect(useTaskBulkSelection.getState().selectedIds).toEqual(["1", "3"]);
  });

  it("replaces the whole selection via setSelection", () => {
    const store = useTaskBulkSelection.getState();
    store.selectMany(["1", "2"], true);
    store.setSelection(["9"]);
    expect(useTaskBulkSelection.getState().selectedIds).toEqual(["9"]);
  });

  it("clears every selected task", () => {
    const store = useTaskBulkSelection.getState();
    store.selectMany(["1", "2"], true);
    store.clear();
    expect(useTaskBulkSelection.getState().selectedIds).toEqual([]);
  });

  it("exposes an isBatchSelected helper over the id list", () => {
    expect(isBatchSelected(["1", "2"], "2")).toBe(true);
    expect(isBatchSelected(["1", "2"], "3")).toBe(false);
  });

  it("builds a stable, screen-reader friendly checkbox label", () => {
    expect(taskCheckboxLabel("task-9")).toBe("Select task task-9 for batch");
  });
});