import { render, screen, fireEvent } from "@testing-library/react";
import { VirtualizedTaskList } from "../VirtualizedTaskList";
import { generateMockTasks } from "../../lib/mockTasks";

function mockResizeObserver(value: unknown) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value,
  });
}

// jsdom does not implement layout, so the virtualizer cannot measure rows or
// the scroll viewport. Tests pass `forceRenderCount` to render a deterministic
// slice from the top — enough to assert on row content, interactions, and
// keyboard behavior without depending on real layout.

describe("VirtualizedTaskList", () => {
  const OriginalResizeObserver = window.ResizeObserver;

  afterEach(() => {
    mockResizeObserver(OriginalResizeObserver);
  });

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

  it("renders loading-more state for massive datasets", () => {
    const tasks = generateMockTasks(1000);
    render(
      <VirtualizedTaskList
        tasks={tasks}
        hasMore
        isLoadingMore
        forceRenderCount={20}
      />,
    );
    expect(screen.getByTestId("task-list-load-more")).toHaveTextContent(
      "Loading more tasks",
    );
  });

  it("requests next page when near scroll end", () => {
    const tasks = generateMockTasks(120);
    const onLoadMore = jest.fn();
    render(
      <VirtualizedTaskList
        tasks={tasks}
        hasMore
        onLoadMore={onLoadMore}
        loadMoreThresholdPx={60}
        forceRenderCount={25}
      />,
    );

    const list = screen.getByTestId("task-list-scroll");
    Object.defineProperty(list, 'scrollTop', { value: 540, writable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, writable: true });
    Object.defineProperty(list, 'clientHeight', { value: 420, writable: true });
    fireEvent.scroll(list);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("shows fallback layout when ResizeObserver is unavailable", () => {
    mockResizeObserver(undefined);
    const tasks = generateMockTasks(20);
    render(<VirtualizedTaskList tasks={tasks} />);
    expect(screen.getByTestId("task-list-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("task-list-fallback-banner")).toBeInTheDocument();
  });

  it("renders stable fallback rows capped by fallbackVisibleCount", () => {
    mockResizeObserver(undefined);
    const tasks = generateMockTasks(200);
    render(
      <VirtualizedTaskList tasks={tasks} fallbackVisibleCount={12} />,
    );
    expect(screen.getAllByTestId("task-row-fallback")).toHaveLength(12);
  });
});
