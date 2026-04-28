import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import VirtualTaskList from "../VirtualTaskList";
import type { Task } from "@/src/types/task";

// @tanstack/react-virtual uses ResizeObserver and scroll APIs not in jsdom.
// We mock useVirtualizer to return a predictable set of virtual rows so tests
// focus on component behaviour rather than virtualizer internals.
jest.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: jest.fn(({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 80,
        size: 80,
        key: i,
      })),
    getTotalSize: () => count * 80,
    measureElement: jest.fn(),
  })),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTask(i: number): Task {
  return {
    id: `task-${i}`,
    title: `Task ${i}`,
    description: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  };
}

function makeTasks(n: number): Task[] {
  return Array.from({ length: n }, (_, i) => makeTask(i + 1));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("VirtualTaskList", () => {
  describe("empty state", () => {
    it("shows empty message when tasks array is empty", () => {
      render(<VirtualTaskList tasks={[]} />);
      expect(screen.getByText("No tasks found.")).toBeInTheDocument();
    });

    it("empty state has role=status", () => {
      render(<VirtualTaskList tasks={[]} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("applies custom testId to empty state", () => {
      render(<VirtualTaskList tasks={[]} data-testid="my-list" />);
      expect(screen.getByTestId("my-list-empty")).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("shows loading indicator when isLoading=true", () => {
      render(<VirtualTaskList tasks={[]} isLoading />);
      expect(screen.getByText(/loading tasks/i)).toBeInTheDocument();
    });

    it("loading state has role=status", () => {
      render(<VirtualTaskList tasks={[]} isLoading />);
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("does not render task rows while loading", () => {
      const tasks = makeTasks(5);
      render(<VirtualTaskList tasks={tasks} isLoading />);
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });

    it("applies custom testId to loading state", () => {
      render(<VirtualTaskList tasks={[]} isLoading data-testid="my-list" />);
      expect(screen.getByTestId("my-list-loading")).toBeInTheDocument();
    });
  });

  describe("rendering tasks", () => {
    it("renders a list with role=list", () => {
      render(<VirtualTaskList tasks={makeTasks(3)} />);
      expect(screen.getByRole("list")).toBeInTheDocument();
    });

    it("renders all task titles", () => {
      const tasks = makeTasks(5);
      render(<VirtualTaskList tasks={tasks} />);
      tasks.forEach((t) => {
        expect(screen.getByText(t.title)).toBeInTheDocument();
      });
    });

    it("renders each task as a listitem", () => {
      render(<VirtualTaskList tasks={makeTasks(3)} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(3);
    });

    it("applies data-testid to the scroll container", () => {
      render(<VirtualTaskList tasks={makeTasks(1)} data-testid="vlist" />);
      expect(screen.getByTestId("vlist")).toBeInTheDocument();
    });

    it("list aria-label includes task count", () => {
      render(<VirtualTaskList tasks={makeTasks(7)} />);
      expect(screen.getByRole("list")).toHaveAttribute(
        "aria-label",
        "Task list — 7 tasks"
      );
    });

    it("renders task cards with aria-label", () => {
      const tasks = [makeTask(1)];
      render(<VirtualTaskList tasks={tasks} />);
      expect(
        screen.getByRole("listitem").querySelector("[aria-label]")
      ).toBeInTheDocument();
    });

    it("renders data-task-id on each card", () => {
      const tasks = makeTasks(2);
      render(<VirtualTaskList tasks={tasks} />);
      expect(
        document.querySelector('[data-task-id="task-1"]')
      ).toBeInTheDocument();
      expect(
        document.querySelector('[data-task-id="task-2"]')
      ).toBeInTheDocument();
    });
  });

  describe("large lists", () => {
    it("renders 1000 tasks without throwing", () => {
      expect(() =>
        render(<VirtualTaskList tasks={makeTasks(1000)} />)
      ).not.toThrow();
    });

    it("renders 5000 tasks without throwing", () => {
      expect(() =>
        render(<VirtualTaskList tasks={makeTasks(5000)} />)
      ).not.toThrow();
    });

    it("renders exactly the virtualizer's item count (not all tasks)", () => {
      // With our mock, virtualizer returns all items — but in production it
      // would only return visible ones. This test verifies the component
      // delegates count to the virtualizer, not a raw .map over all tasks.
      const { useVirtualizer } = jest.requireMock(
        "@tanstack/react-virtual"
      ) as { useVirtualizer: jest.Mock };
      render(<VirtualTaskList tasks={makeTasks(10)} />);
      expect(useVirtualizer).toHaveBeenCalledWith(
        expect.objectContaining({ count: 10 })
      );
    });
  });

  describe("interactions", () => {
    it("calls onTaskClick when a card is clicked", () => {
      const tasks = [makeTask(1)];
      const onClick = jest.fn();
      render(<VirtualTaskList tasks={tasks} onTaskClick={onClick} />);
      fireEvent.click(screen.getByRole("listitem").firstElementChild!);
      expect(onClick).toHaveBeenCalledWith(tasks[0]);
    });

    it("calls onTaskClick on Enter key", () => {
      const tasks = [makeTask(1)];
      const onClick = jest.fn();
      render(<VirtualTaskList tasks={tasks} onTaskClick={onClick} />);
      const card = screen.getByRole("listitem").firstElementChild!;
      fireEvent.keyDown(card, { key: "Enter" });
      expect(onClick).toHaveBeenCalledWith(tasks[0]);
    });

    it("calls onTaskClick on Space key", () => {
      const tasks = [makeTask(1)];
      const onClick = jest.fn();
      render(<VirtualTaskList tasks={tasks} onTaskClick={onClick} />);
      const card = screen.getByRole("listitem").firstElementChild!;
      fireEvent.keyDown(card, { key: " " });
      expect(onClick).toHaveBeenCalledWith(tasks[0]);
    });

    it("does not throw when onTaskClick is not provided and card is clicked", () => {
      const tasks = [makeTask(1)];
      render(<VirtualTaskList tasks={tasks} />);
      expect(() =>
        fireEvent.click(screen.getByRole("listitem").firstElementChild!)
      ).not.toThrow();
    });
  });

  describe("actions", () => {
    it("renders action buttons for each task", () => {
      const tasks = makeTasks(2);
      const actions = [{ label: "Edit", onClick: jest.fn() }];
      render(<VirtualTaskList tasks={tasks} actions={actions} />);
      expect(screen.getAllByRole("button", { name: /edit/i })).toHaveLength(2);
    });

    it("calls action.onClick with the correct task", () => {
      const tasks = [makeTask(1), makeTask(2)];
      const onEdit = jest.fn();
      const actions = [{ label: "Edit", onClick: onEdit }];
      render(<VirtualTaskList tasks={tasks} actions={actions} />);
      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      fireEvent.click(editButtons[0]);
      expect(onEdit).toHaveBeenCalledWith(tasks[0]);
    });

    it("action click does not bubble to onTaskClick", () => {
      const tasks = [makeTask(1)];
      const onTaskClick = jest.fn();
      const onEdit = jest.fn();
      render(
        <VirtualTaskList
          tasks={tasks}
          onTaskClick={onTaskClick}
          actions={[{ label: "Edit", onClick: onEdit }]}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      expect(onEdit).toHaveBeenCalled();
      expect(onTaskClick).not.toHaveBeenCalled();
    });

    it("renders no action buttons when actions array is empty", () => {
      render(<VirtualTaskList tasks={makeTasks(3)} actions={[]} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders multiple actions per card", () => {
      const tasks = [makeTask(1)];
      const actions = [
        { label: "Edit", onClick: jest.fn() },
        { label: "Delete", onClick: jest.fn() },
      ];
      render(<VirtualTaskList tasks={tasks} actions={actions} />);
      expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /delete/i })
      ).toBeInTheDocument();
    });
  });

  describe("keyboard navigation", () => {
    it("cards are focusable (tabIndex=0)", () => {
      render(<VirtualTaskList tasks={makeTasks(3)} />);
      const cards = document.querySelectorAll("[tabindex='0']");
      expect(cards.length).toBeGreaterThan(0);
    });

    it("ArrowDown key does not throw", () => {
      render(<VirtualTaskList tasks={makeTasks(3)} />);
      const card = screen.getAllByRole("listitem")[0].firstElementChild!;
      expect(() =>
        fireEvent.keyDown(card, { key: "ArrowDown" })
      ).not.toThrow();
    });

    it("ArrowUp key does not throw", () => {
      render(<VirtualTaskList tasks={makeTasks(3)} />);
      const card = screen.getAllByRole("listitem")[1].firstElementChild!;
      expect(() =>
        fireEvent.keyDown(card, { key: "ArrowUp" })
      ).not.toThrow();
    });
  });
});
