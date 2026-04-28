import { render, screen, fireEvent } from "@testing-library/react";
import { VirtualizedTaskList } from "../VirtualizedTaskList";
import { generateMockTasks } from "../../lib/mockTasks";

// jsdom does not implement layout, so the virtualizer cannot measure rows or
// the scroll viewport. Tests pass `forceRenderCount` to render a deterministic
// slice from the top — enough to assert on row content, interactions, and
// keyboard behavior without depending on real layout.

describe("VirtualizedTaskList", () => {
  it("renders the empty state when there are no tasks", () => {
    render(<VirtualizedTaskList tasks={[]} />);
    expect(screen.getByTestId("task-list-empty")).toBeInTheDocument();
  });

  it("renders the loading state when loading", () => {
    render(<VirtualizedTaskList tasks={[]} loading />);
    expect(screen.getByTestId("task-list-loading")).toBeInTheDocument();
  });

  it("renders only a windowed slice of a large dataset", () => {
    const tasks = generateMockTasks(10_000);
    render(<VirtualizedTaskList tasks={tasks} forceRenderCount={20} />);
    const rows = screen.getAllByTestId("task-row");
    expect(rows.length).toBe(20);
    // The last row should be the 20th task, not the 10,000th — proving we are
    // not rendering the whole list.
    expect(rows[rows.length - 1]).toHaveAttribute("data-index", "19");
  });

  it("calls onSelect when a row is clicked", () => {
    const tasks = generateMockTasks(50);
    const onSelect = jest.fn();
    render(
      <VirtualizedTaskList
        tasks={tasks}
        onSelect={onSelect}
        forceRenderCount={5}
      />,
    );
    fireEvent.click(screen.getAllByTestId("task-row")[2]);
    expect(onSelect).toHaveBeenCalledWith(tasks[2].id);
  });

  it("supports keyboard navigation and selection", () => {
    const tasks = generateMockTasks(10);
    const onSelect = jest.fn();
    render(
      <VirtualizedTaskList
        tasks={tasks}
        onSelect={onSelect}
        forceRenderCount={10}
      />,
    );
    const list = screen.getByTestId("task-list-scroll");
    list.focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(tasks[2].id);
  });

  it("marks the active row via aria-activedescendant", () => {
    const tasks = generateMockTasks(10);
    render(<VirtualizedTaskList tasks={tasks} forceRenderCount={10} />);
    const list = screen.getByTestId("task-list-scroll");
    list.focus();
    expect(list).toHaveAttribute("aria-activedescendant", tasks[0].id);
    fireEvent.keyDown(list, { key: "End" });
    expect(list).toHaveAttribute(
      "aria-activedescendant",
      tasks[tasks.length - 1].id,
    );
  });
});
