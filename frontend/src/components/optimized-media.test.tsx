import { fireEvent, render, screen } from "@testing-library/react";
import { OptimizedMedia } from "./optimized-media";

describe("OptimizedMedia", () => {
  it("renders a fallback immediately when no source is provided", () => {
    const onRenderComplete = jest.fn();

    render(
      <OptimizedMedia
        alt="Missing preview"
        width={320}
        height={200}
        fallbackLabel="No preview"
        onRenderComplete={onRenderComplete}
      />,
    );

    expect(screen.getByText("No preview")).toBeInTheDocument();
    expect(screen.queryByAltText("Missing preview")).not.toBeInTheDocument();
    expect(onRenderComplete).toHaveBeenCalledWith("fallback", expect.any(Number));
  });

  it("falls back cleanly when an image fails to load", () => {
    const onRenderComplete = jest.fn();

    render(
      <OptimizedMedia
        alt="Task preview"
        src="/missing-image.png"
        width={320}
        height={200}
        fallbackLabel="Fallback preview"
        onRenderComplete={onRenderComplete}
      />,
    );

    fireEvent.error(screen.getByAltText("Task preview"));

    expect(screen.getByText("Fallback preview")).toBeInTheDocument();
    expect(onRenderComplete).toHaveBeenCalledWith("fallback", expect.any(Number));
  });
});
