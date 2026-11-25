import {
  createShortcutManager,
  eventToShortcutCombo,
  processShortcutInMainThread,
  type ShortcutDefinition,
} from "../shortcutManager";

const shortcuts: ShortcutDefinition[] = [
  { id: "open", combo: "ctrl+k", description: "Open command palette" },
  { id: "save", combo: "ctrl+s", description: "Save draft" },
];

describe("shortcutManager utility", () => {
  it("builds normalized combo strings", () => {
    expect(
      eventToShortcutCombo({
        key: "K",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe("ctrl+k");
  });

  it("matches shortcuts in main-thread mode", () => {
    const match = processShortcutInMainThread(shortcuts, {
      key: "s",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });
    expect(match?.id).toBe("save");
  });

  it("returns null for unknown shortcuts", () => {
    const match = processShortcutInMainThread(shortcuts, {
      key: "x",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });
    expect(match).toBeNull();
  });
});

describe("createShortcutManager worker behavior", () => {
  const OriginalWorker = global.Worker;

  afterEach(() => {
    global.Worker = OriginalWorker;
    jest.clearAllMocks();
  });

  it("falls back to main thread when Worker is unavailable", () => {
    // @ts-expect-error test override
    global.Worker = undefined;

    const onShortcut = jest.fn();
    const manager = createShortcutManager({ shortcuts, onShortcut });

    expect(manager.isWorkerBacked).toBe(false);
    manager.processKeyboardEvent({
      key: "k",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });

    expect(onShortcut).toHaveBeenCalledWith(
      expect.objectContaining({ id: "open", combo: "ctrl+k" }),
    );
  });

  it("uses worker messaging when Worker is supported", () => {
    class WorkerMock {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      postMessage = jest.fn((message: { type: string }) => {
        if (message.type === "PROCESS_KEY_EVENT" && this.onmessage) {
          this.onmessage(
            {
              data: {
                type: "SHORTCUT_RESULT",
                payload: {
                  matched: {
                    id: "open",
                    combo: "ctrl+k",
                    description: "Open command palette",
                  },
                },
              },
            } as MessageEvent,
          );
        }
      });
      terminate = jest.fn();
    }

    // @ts-expect-error test override
    global.Worker = WorkerMock;

    const onShortcut = jest.fn();
    const manager = createShortcutManager({ shortcuts, onShortcut });

    expect(manager.isWorkerBacked).toBe(true);

    manager.processKeyboardEvent({
      key: "k",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });

    expect(onShortcut).toHaveBeenCalledWith(
      expect.objectContaining({ id: "open", combo: "ctrl+k" }),
    );
    manager.destroy();
  });

  it("falls back to main thread when worker postMessage throws", () => {
    class WorkerMock {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      postMessage = jest.fn((message: { type: string }) => {
        if (message.type === "PROCESS_KEY_EVENT") {
          throw new Error("worker post failed");
        }
      });
      terminate = jest.fn();
    }

    // @ts-expect-error test override
    global.Worker = WorkerMock;

    const onShortcut = jest.fn();
    const onError = jest.fn();
    const manager = createShortcutManager({
      shortcuts,
      onShortcut,
      onError,
    });

    manager.processKeyboardEvent({
      key: "k",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });

    expect(onError).toHaveBeenCalled();
    expect(onShortcut).toHaveBeenCalledWith(
      expect.objectContaining({ id: "open", combo: "ctrl+k" }),
    );
  });

  it("reports worker initialization failures", () => {
    class WorkerMock {
      constructor() {
        throw new Error("boom");
      }
    }

    // @ts-expect-error test override
    global.Worker = WorkerMock;

    const onError = jest.fn();
    const manager = createShortcutManager({
      shortcuts,
      onShortcut: jest.fn(),
      onError,
    });

    expect(manager.isWorkerBacked).toBe(false);
    expect(onError).toHaveBeenCalled();
  });
});
