import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WidgetGrid } from "@/components/WidgetGrid";
import type { WidgetDefinition } from "@/components/WidgetGrid";

describe("WidgetGrid", () => {
  const mockWidgets: Record<string, WidgetDefinition> = {
    widget1: {
      id: "widget1",
      title: "Test Widget 1",
      description: "First test widget",
      defaultSize: "small",
      getStatus: () => "success",
      render: () => <div data-testid="widget1-content">Content 1</div>,
    },
    widget2: {
      id: "widget2",
      title: "Test Widget 2",
      description: "Second test widget",
      defaultSize: "medium",
      getStatus: () => "loading",
      render: () => <div data-testid="widget2-content">Content 2</div>,
    },
    widget3: {
      id: "widget3",
      title: "Test Widget 3",
      description: "Third test widget",
      defaultSize: "large",
      getStatus: () => "error",
      render: () => <div data-testid="widget3-content">Content 3</div>,
    },
    widget4: {
      id: "widget4",
      title: "Empty Widget",
      description: "Widget with empty status",
      defaultSize: "small",
      getStatus: () => "empty",
      render: () => <div data-testid="widget4-content">No data</div>,
    },
  };

  const customStorageKey = "test.widget.grid.config";

  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("Widget Rendering", () => {
    it("renders all widgets from registry", () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      expect(screen.getByTestId("widget-widget1")).toBeInTheDocument();
      expect(screen.getByTestId("widget-widget2")).toBeInTheDocument();
      expect(screen.getByTestId("widget-widget3")).toBeInTheDocument();
      expect(screen.getByTestId("widget-widget4")).toBeInTheDocument();
    });

    it("renders widget titles and descriptions", () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      expect(screen.getAllByText("Test Widget 1")[0]).toBeInTheDocument();
      expect(screen.getByText("First test widget")).toBeInTheDocument();
      expect(screen.getAllByText("Test Widget 2")[0]).toBeInTheDocument();
    });

    it("renders widget content via render function for resolved widgets", () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      expect(screen.getByTestId("widget1-content")).toBeInTheDocument();
      expect(screen.getByTestId("widget3-content")).toBeInTheDocument();
    });

    it("renders a skeleton instead of content while a widget is loading", () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      expect(screen.getByTestId("widget-widget2")).toContainElement(
        screen.getByLabelText("Loading widget data")
      );
      expect(screen.queryByTestId("widget2-content")).not.toBeInTheDocument();
    });

    it("displays status badges for each widget", () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      expect(screen.getByText("success")).toBeInTheDocument();
      expect(screen.getByText("loading")).toBeInTheDocument();
      expect(screen.getByText("error")).toBeInTheDocument();
      expect(screen.getByText("empty")).toBeInTheDocument();
    });

    it("applies correct size classes based on widget size", () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const widgets = container.querySelectorAll('article[data-testid^="widget-"]');
      expect(widgets[0]).toHaveClass("md:col-span-1");
      expect(widgets[1]).toHaveClass("md:col-span-1");
      expect(widgets[2]).toHaveClass("md:col-span-2");
    });
  });

  describe("Widget Visibility Toggle", () => {
    it("renders visibility controls for all widgets", () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      expect(screen.getByLabelText("Toggle Test Widget 1 widget visibility")).toBeInTheDocument();
      expect(screen.getByLabelText("Toggle Test Widget 2 widget visibility")).toBeInTheDocument();
    });

    it("hides widget when checkbox is unchecked", async () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      const checkbox = screen.getByLabelText("Toggle Test Widget 1 widget visibility");
      expect(screen.getByTestId("widget-widget1")).toBeInTheDocument();

      fireEvent.click(checkbox);

      await waitFor(() => {
        expect(screen.queryByTestId("widget-widget1")).not.toBeInTheDocument();
      });
    });

    it("shows widget when checkbox is checked after being unchecked", async () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      const checkbox = screen.getByLabelText("Toggle Test Widget 1 widget visibility");
      fireEvent.click(checkbox);
      await waitFor(() => {
        expect(screen.queryByTestId("widget-widget1")).not.toBeInTheDocument();
      });

      fireEvent.click(checkbox);

      await waitFor(() => {
        expect(screen.getByTestId("widget-widget1")).toBeInTheDocument();
      });
    });

    it("maintains widget order when toggling visibility", async () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      const checkbox1 = screen.getByLabelText("Toggle Test Widget 1 widget visibility");
      const checkbox2 = screen.getByLabelText("Toggle Test Widget 2 widget visibility");

      fireEvent.click(checkbox1);
      await waitFor(() => {
        expect(screen.queryByTestId("widget-widget1")).not.toBeInTheDocument();
        expect(screen.getByTestId("widget-widget2")).toBeInTheDocument();
      });

      fireEvent.click(checkbox2);
      await waitFor(() => {
        expect(screen.queryByTestId("widget-widget2")).not.toBeInTheDocument();
        expect(screen.queryByTestId("widget-widget1")).not.toBeInTheDocument();
      });
    });
  });

  describe("Drag and Drop Reordering", () => {
    it("widgets have draggable attribute", () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const widgets = container.querySelectorAll('article[data-testid^="widget-"]');
      widgets.forEach((widget) => {
        expect(widget).toHaveAttribute("draggable");
      });
    });

    it("reorders widgets on drop", async () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const widgets = Array.from(
        container.querySelectorAll('article[data-testid^="widget-"]')
      );
      const firstWidget = widgets[0];
      const secondWidget = widgets[1];

      fireEvent.dragStart(firstWidget);
      fireEvent.dragOver(secondWidget);
      fireEvent.drop(secondWidget);

      await waitFor(() => {
        const reorderedWidgets = container.querySelectorAll(
          'article[data-testid^="widget-"]'
        );
        expect(reorderedWidgets[0]).toHaveAttribute("data-testid", "widget-widget2");
        expect(reorderedWidgets[1]).toHaveAttribute("data-testid", "widget-widget1");
      });
    });

    it("does not change order when dropping on same widget", async () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const widgets = Array.from(
        container.querySelectorAll('article[data-testid^="widget-"]')
      );
      const firstWidget = widgets[0];

      const initialOrder = Array.from(
        container.querySelectorAll('article[data-testid^="widget-"]')
      ).map((el) => el.getAttribute("data-testid"));

      fireEvent.dragStart(firstWidget);
      fireEvent.dragOver(firstWidget);
      fireEvent.drop(firstWidget);

      await waitFor(() => {
        const finalOrder = Array.from(
          container.querySelectorAll('article[data-testid^="widget-"]')
        ).map((el) => el.getAttribute("data-testid"));
        expect(finalOrder).toEqual(initialOrder);
      });
    });
  });

  describe("localStorage Persistence", () => {
    it("loads saved configuration from localStorage on mount", async () => {
      const savedConfig = {
        widgetOrder: ["widget3", "widget1", "widget2", "widget4"],
        hiddenWidgetIds: ["widget2"],
      };
      window.localStorage.setItem(customStorageKey, JSON.stringify(savedConfig));

      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      await waitFor(() => {
        const widgets = Array.from(
          container.querySelectorAll('article[data-testid^="widget-"]')
        ).map((el) => el.getAttribute("data-testid"));
        expect(widgets[0]).toBe("widget-widget3");
        expect(widgets[1]).toBe("widget-widget1");
        expect(widgets.length).toBe(3);
      });
    });

    it("uses default order when no saved configuration exists", async () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      await waitFor(() => {
        const widgets = Array.from(
          container.querySelectorAll('article[data-testid^="widget-"]')
        ).map((el) => el.getAttribute("data-testid"));
        expect(widgets[0]).toBe("widget-widget1");
        expect(widgets[1]).toBe("widget-widget2");
      });
    });

    it("saves configuration to localStorage when order changes", async () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      await waitFor(() => {
        expect(screen.getByTestId("widget-widget1")).toBeInTheDocument();
      });

      const widgets = Array.from(
        container.querySelectorAll('article[data-testid^="widget-"]')
      );
      fireEvent.dragStart(widgets[0]);
      fireEvent.dragOver(widgets[1]);
      fireEvent.drop(widgets[1]);

      await waitFor(() => {
        const saved = JSON.parse(
          window.localStorage.getItem(customStorageKey)!
        );
        expect(saved.widgetOrder[0]).toBe("widget2");
        expect(saved.widgetOrder[1]).toBe("widget1");
      });
    });

    it("saves hidden widget IDs to localStorage when toggled", async () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />);

      const checkbox = screen.getByLabelText("Toggle Test Widget 1 widget visibility");
      fireEvent.click(checkbox);

      await waitFor(() => {
        const saved = JSON.parse(
          window.localStorage.getItem(customStorageKey)!
        );
        expect(saved.hiddenWidgetIds).toContain("widget1");
      });
    });

    it("handles malformed localStorage data gracefully", async () => {
      window.localStorage.setItem(customStorageKey, "invalid-json");

      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      await waitFor(() => {
        expect(screen.getByTestId("widget-widget1")).toBeInTheDocument();
      });
    });

    it("filters out invalid widget IDs from saved order", async () => {
      const savedConfig = {
        widgetOrder: ["widget1", "invalid-widget", "widget2"],
        hiddenWidgetIds: [],
      };
      window.localStorage.setItem(customStorageKey, JSON.stringify(savedConfig));

      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      await waitFor(() => {
        const widgets = Array.from(
          container.querySelectorAll('article[data-testid^="widget-"]')
        ).map((el) => el.getAttribute("data-testid"));
        expect(widgets.length).toBe(4);
        expect(widgets).toContain("widget-widget1");
        expect(widgets).toContain("widget-widget2");
      });
    });

    it("removes duplicate widget IDs from saved order", async () => {
      const savedConfig = {
        widgetOrder: ["widget1", "widget2", "widget1", "widget2"],
        hiddenWidgetIds: [],
      };
      window.localStorage.setItem(customStorageKey, JSON.stringify(savedConfig));

      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      await waitFor(() => {
        const widgets = Array.from(
          container.querySelectorAll('article[data-testid^="widget-"]')
        );
        expect(widgets.length).toBe(4);
      });
    });

    it("filters hidden widget IDs to only known widgets", async () => {
      const savedConfig = {
        widgetOrder: ["widget1", "widget2", "widget3", "widget4"],
        hiddenWidgetIds: ["widget1", "unknown-widget"],
      };
      window.localStorage.setItem(customStorageKey, JSON.stringify(savedConfig));

      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      await waitFor(() => {
        const widgets = Array.from(
          container.querySelectorAll('article[data-testid^="widget-"]')
        );
        expect(widgets.length).toBe(3);
        expect(widgets[0]).toHaveAttribute("data-testid", "widget-widget2");
      });
    });
  });

  describe("Loading States", () => {
    it("shows loading state initially with opacity transition", async () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const widgets = container.querySelectorAll('article[data-testid^="widget-"]');
      widgets.forEach((widget) => {
        expect(widget).toHaveClass("opacity-100");
      });
    });

    it("applies drag opacity when dragging a widget", async () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const firstWidget = container.querySelector(
        '[data-testid="widget-widget1"]'
      );

      fireEvent.dragStart(firstWidget!);

      await waitFor(() => {
        expect(firstWidget).toHaveClass("opacity-60");
      });

      const otherWidgets = Array.from(
        container.querySelectorAll('article[data-testid^="widget-"]')
      ).filter((w) => w !== firstWidget);

      otherWidgets.forEach((widget) => {
        expect(widget).toHaveClass("opacity-100");
      });
    });

    it("resets opacity after drag ends", async () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const firstWidget = container.querySelector(
        'article[data-testid="widget-widget1"]'
      );

      fireEvent.dragStart(firstWidget!);
      await waitFor(() => {
        expect(firstWidget).toHaveClass("opacity-60");
      });

      fireEvent.dragEnd(firstWidget!);

      await waitFor(() => {
        expect(firstWidget).toHaveClass("opacity-100");
      });
    });
  });

  describe("Status Styling", () => {
    it("applies success styling to successful widgets", () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const successWidget = screen.getByTestId("widget-widget1");
      expect(successWidget).toHaveClass("border-emerald-400/30");
      expect(successWidget).toHaveClass("bg-emerald-500/10");
    });

    it("applies loading styling to loading widgets", () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const loadingWidget = screen.getByTestId("widget-widget2");
      expect(loadingWidget).toHaveClass("border-amber-400/40");
      expect(loadingWidget).toHaveClass("bg-amber-500/10");
    });

    it("applies error styling to error widgets", () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const errorWidget = screen.getByTestId("widget-widget3");
      expect(errorWidget).toHaveClass("border-rose-400/40");
      expect(errorWidget).toHaveClass("bg-rose-500/10");
    });

    it("applies empty styling to empty widgets", () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const emptyWidget = screen.getByTestId("widget-widget4");
      expect(emptyWidget).toHaveClass("border-slate-500/40");
      expect(emptyWidget).toHaveClass("bg-slate-500/10");
    });
  });

  describe("Accessibility", () => {
    it("has aria-grabbed attribute for draggable widgets", () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const widgets = container.querySelectorAll('article[data-testid^="widget-"]');
      widgets.forEach((widget) => {
        expect(widget).toHaveAttribute("aria-grabbed", "false");
      });
    });

    it("has aria-grabbed set to true when dragging", async () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const firstWidget = container.querySelector(
        '[data-testid="widget-widget1"]'
      );
      fireEvent.dragStart(firstWidget!);

      await waitFor(() => {
        expect(firstWidget).toHaveAttribute("aria-grabbed", "true");
      });
    });

    it("has aria-describedby pointing to status element", () => {
      render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const widget = screen.getByTestId("widget-widget1");
      expect(widget).toHaveAttribute("aria-describedby", "widget-status-widget1");
    });

    it("has accessible label for visibility controls section", () => {
      render(
        <WidgetGrid widgetRegistry={mockWidgets} storageKey={customStorageKey} />
      );

      const section = screen.getByLabelText("Widget visibility controls");
      expect(section).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("handles empty widget registry gracefully", () => {
      const { container } = render(
        <WidgetGrid widgetRegistry={{}} storageKey={customStorageKey} />
      );

      const widgets = container.querySelectorAll('[data-testid^="widget-"]');
      expect(widgets.length).toBe(0);
    });

    it("uses default storage key when none provided", async () => {
      render(<WidgetGrid widgetRegistry={mockWidgets} />);

      const checkbox = screen.getByLabelText("Toggle Test Widget 1 widget visibility");
      fireEvent.click(checkbox);

      await waitFor(() => {
        expect(
          window.localStorage.getItem("sorotask.dashboard.config.v1")
        ).not.toBeNull();
      });
    });

    it("handles widget with dynamic status", async () => {
      const dynamicWidgets = {
        dynamic: {
          id: "dynamic",
          title: "Dynamic Widget",
          description: "Changes status",
          defaultSize: "small" as const,
          getStatus: jest.fn(() => "loading"),
          render: () => <div>Dynamic content</div>,
        },
      };

      const { rerender } = render(
        <WidgetGrid
          widgetRegistry={dynamicWidgets}
          storageKey={customStorageKey}
        />
      );

      expect(screen.getByText("loading")).toBeInTheDocument();

      (dynamicWidgets.dynamic.getStatus as jest.Mock).mockReturnValue("success");

      rerender(
        <WidgetGrid
          widgetRegistry={dynamicWidgets}
          storageKey={customStorageKey}
        />
      );

      expect(screen.getByText("success")).toBeInTheDocument();
    });
  });
});
