import { fireEvent, render, screen } from "@testing-library/react";
import TasksPage from "./page";
import { useTasks } from "@/src/hooks/tasks";
import type { ReactNode } from "react";

jest.mock("@/src/hooks/tasks", () => ({
  useTasks: jest.fn(),
}));

jest.mock("@/src/store/layoutStore", () => ({
  useLayoutStore: () => ({
    listScrollPosition: 0,
    saveListScrollPosition: jest.fn(),
  }),
}));

jest.mock("@/src/components/layout/SplitPaneLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/TaskCardWithSelection", () => ({
  __esModule: true,
  default: ({ task }: { task: { id: string } }) => (
    <article data-testid="task-card">{task.id}</article>
  ),
}));

jest.mock("@/app/tasks/bulk/TaskSelectableCard", () => ({
  __esModule: true,
  default: ({ task }: { task: { id: string } }) => (
    <article data-testid="task-card">{task.id}</article>
  ),
}));

jest.mock("@/app/tasks/bulk/BulkSelectAllBar", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/app/tasks/bulk/BatchActionConsole", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/app/tasks/bulk/bulkSelectionStore", () => ({
  useTaskBulkSelection: jest.fn(() => []),
}));

const mockUseTasks = useTasks as jest.Mock;

function makeTasks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index + 1}`,
  }));
}

describe("TasksPage pagination", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows 10 tasks per page and moves between pages", () => {
    mockUseTasks.mockReturnValue({ data: makeTasks(23), isLoading: false });

    render(<TasksPage />);

    expect(screen.getAllByTestId("task-card")).toHaveLength(10);
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.queryByText("task-11")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-10 of 23 tasks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getAllByTestId("task-card")).toHaveLength(10);
    expect(screen.getByText("task-11")).toBeInTheDocument();
    expect(screen.queryByText("task-1")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 11-20 of 23 tasks")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getAllByTestId("task-card")).toHaveLength(3);
    expect(screen.getByText("task-23")).toBeInTheDocument();
    expect(screen.getByText("Showing 21-23 of 23 tasks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(screen.getAllByTestId("task-card")).toHaveLength(10);
    expect(screen.getByText("task-11")).toBeInTheDocument();
  });

  it("resets to the first page when filters change", () => {
    mockUseTasks.mockReturnValue({ data: makeTasks(23), isLoading: false });

    render(<TasksPage />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 11-20 of 23 tasks")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search tasks..."), {
      target: { value: "rebalance" },
    });

    expect(screen.getByText("Showing 1-10 of 23 tasks")).toBeInTheDocument();
  });
});
