import { createCanvasRenderPipeline } from "../canvasRenderPipeline";

describe("createCanvasRenderPipeline", () => {
  const originalRaf = global.requestAnimationFrame;
  const originalCancel = global.cancelAnimationFrame;

  afterEach(() => {
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancel;
    jest.restoreAllMocks();
  });

  function createCanvasMock(withContext = true): HTMLCanvasElement {
    const listeners = new Map<string, EventListener[]>();

    const context = withContext
      ? {
          clearRect: jest.fn(),
          beginPath: jest.fn(),
          moveTo: jest.fn(),
          lineTo: jest.fn(),
          stroke: jest.fn(),
          fillRect: jest.fn(),
          fillText: jest.fn(),
          lineWidth: 1,
          strokeStyle: "",
          fillStyle: "",
          font: "",
        }
      : null;

    return {
      width: 1200,
      height: 800,
      getContext: jest.fn(() => context),
      addEventListener: jest.fn((type: string, handler: EventListener) => {
        const arr = listeners.get(type) ?? [];
        arr.push(handler);
        listeners.set(type, arr);
      }),
      removeEventListener: jest.fn((type: string, handler: EventListener) => {
        const arr = listeners.get(type) ?? [];
        listeners.set(type, arr.filter((h) => h !== handler));
      }),
      dispatchEvent: jest.fn((event: Event) => {
        const arr = listeners.get(event.type) ?? [];
        arr.forEach((handler) => handler(event));
        return true;
      }),
    } as unknown as HTMLCanvasElement;
  }

  it("gracefully handles missing canvas context", () => {
    const onError = jest.fn();
    const pipeline = createCanvasRenderPipeline({
      canvas: createCanvasMock(false),
      onError,
    });

    pipeline.updateState({ nodes: [], edges: [] });
    expect(onError).toHaveBeenCalled();
    expect(pipeline.getStats().contextLost).toBe(true);
  });

  it("coalesces updates into one animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    global.cancelAnimationFrame = jest.fn();

    const canvas = createCanvasMock(true);
    const onRender = jest.fn();
    const pipeline = createCanvasRenderPipeline({ canvas, onRender });

    pipeline.updateState({ nodes: [{ id: "a", x: 0, y: 0, width: 10, height: 10, label: "A" }], edges: [] });
    pipeline.updateState({ nodes: [{ id: "a", x: 10, y: 10, width: 10, height: 10, label: "A" }], edges: [] });

    expect(callbacks).toHaveLength(1);
    callbacks[0](16);

    expect(onRender).toHaveBeenCalledTimes(1);
    expect(pipeline.getStats().renderCount).toBe(1);
  });

  it("skips redraw when state hash is unchanged", () => {
    const callbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    global.cancelAnimationFrame = jest.fn();

    const pipeline = createCanvasRenderPipeline({
      canvas: createCanvasMock(true),
    });

    const state = {
      nodes: [{ id: "a", x: 0, y: 0, width: 10, height: 10, label: "A" }],
      edges: [],
    };

    pipeline.updateState(state);
    callbacks[0](16);
    pipeline.updateState(state);
    callbacks[1](32);

    expect(pipeline.getStats().renderCount).toBe(1);
    expect(pipeline.getStats().skippedFrames).toBe(1);
  });

  it("reports draw-loop errors without crashing", () => {
    const callbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    global.cancelAnimationFrame = jest.fn();

    const canvas = createCanvasMock(true);
    const context = canvas.getContext("2d") as unknown as { fillRect: jest.Mock };
    context.fillRect.mockImplementation(() => {
      throw new Error("draw failed");
    });

    const onError = jest.fn();
    const pipeline = createCanvasRenderPipeline({
      canvas,
      onError,
    });

    pipeline.updateState({ nodes: [{ id: "a", x: 0, y: 0, width: 10, height: 10, label: "A" }], edges: [] });
    callbacks[0](16);

    expect(onError).toHaveBeenCalled();
  });

  it("tracks context loss and restoration", () => {
    const callbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    global.cancelAnimationFrame = jest.fn();

    const canvas = createCanvasMock(true);
    const onError = jest.fn();
    const pipeline = createCanvasRenderPipeline({ canvas, onError });

    canvas.dispatchEvent(new Event("contextlost"));
    expect(pipeline.getStats().contextLost).toBe(true);
    expect(onError).toHaveBeenCalled();

    canvas.dispatchEvent(new Event("contextrestored"));
    expect(pipeline.getStats().contextLost).toBe(false);
  });
});
