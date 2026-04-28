import { fireEvent, render, screen } from "@testing-library/react";
import TaskWorkspace from "./TaskWorkspace";

describe("TaskWorkspace unsaved changes protection", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("warns on beforeunload when form is dirty", () => {
    render(<TaskWorkspace />);

    fireEvent.change(screen.getByTestId("target-input"), {
      target: { value: "CAAAAAAAAA" },
    });

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("does not warn on beforeunload when form is clean", () => {
    render(<TaskWorkspace />);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("clears warning after save", () => {
    render(<TaskWorkspace />);

    fireEvent.change(screen.getByTestId("target-input"), {
      target: { value: "CAAAAAAAAA" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByTestId("dirty-state")).toHaveTextContent("All changes saved");
  });

  it("prompts before dismissing dirty modal and keeps it open when canceled", () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    render(<TaskWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.change(screen.getByLabelText(/webhook url/i), {
      target: { value: "https://example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^close settings$/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("dismisses dirty modal when confirmed", () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<TaskWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.change(screen.getByLabelText(/webhook url/i), {
      target: { value: "https://example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^close settings$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
