/**
 * Unit tests for crossChainObserver.js - resilient polling observer.
 * Uses injected sleep and timers, so no real delays or network are involved.
 */

const {
  createCrossChainObserver,
  POLL_TIMEOUT,
} = require("../src/crossChainObserver.js");

function makeFakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => {
      const handle = { fn, ms, cleared: false };
      timers.push(handle);
      return handle;
    },
    clearTimer: (handle) => {
      if (handle) handle.cleared = true;
    },
    fire(index) {
      const handle = timers[index];
      if (!handle.cleared) handle.fn();
    },
  };
}

function makeObserver(source, overrides = {}) {
  const sleep = overrides.sleep || jest.fn(() => Promise.resolve());
  const timers = makeFakeTimers();
  const onEvent = jest.fn();
  const onError = jest.fn();
  const observer = createCrossChainObserver({
    source,
    onEvent,
    onError,
    pollIntervalMs: 100,
    timeoutMs: 1000,
    maxRetries: 3,
    baseBackoffMs: 100,
    maxBackoffMs: 1000,
    ...overrides,
    sleep,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { observer, onEvent, onError, sleep, timers };
}

describe("createCrossChainObserver", () => {
  describe("argument validation", () => {
    it("throws when source.poll is not a function", () => {
      expect(() => createCrossChainObserver({ source: {}, onEvent: jest.fn() })).toThrow(
        TypeError,
      );
    });

    it("throws when onEvent is not a function", () => {
      const source = { poll: jest.fn() };
      expect(() => createCrossChainObserver({ source })).toThrow(TypeError);
    });
  });

  describe("pollOnce", () => {
    it("emits each event from a successful poll once", async () => {
      const events = [{ id: "a" }, { id: "b" }];
      const source = { poll: jest.fn().mockResolvedValue(events) };
      const { observer, onEvent, onError, timers } = makeObserver(source);

      const result = await observer.pollOnce();

      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.emitted).toBe(2);
      expect(onEvent.mock.calls.map((call) => call[0])).toEqual(events);
      expect(onError).not.toHaveBeenCalled();
      expect(timers.timers[0].cleared).toBe(true);
    });

    it("does not emit a repeated event twice", async () => {
      const source = {
        poll: jest
          .fn()
          .mockResolvedValueOnce([{ id: "a" }])
          .mockResolvedValueOnce([{ id: "a" }, { id: "b" }]),
      };
      const { observer, onEvent } = makeObserver(source);

      const first = await observer.pollOnce();
      const second = await observer.pollOnce();

      expect(first.emitted).toBe(1);
      expect(second.emitted).toBe(1);
      expect(onEvent.mock.calls.map((call) => call[0].id)).toEqual(["a", "b"]);
    });

    it("skips events without a key", async () => {
      const source = { poll: jest.fn().mockResolvedValue([{ value: 1 }, { id: "a" }]) };
      const { observer, onEvent } = makeObserver(source);

      const result = await observer.pollOnce();

      expect(result.emitted).toBe(1);
      expect(onEvent.mock.calls.map((call) => call[0].id)).toEqual(["a"]);
    });

    it("retries a failing poll with exponential backoff, then reports the error", async () => {
      const boom = new Error("boom");
      const source = { poll: jest.fn().mockRejectedValue(boom) };
      const { observer, onEvent, onError, sleep } = makeObserver(source, {
        maxRetries: 2,
        baseBackoffMs: 100,
        maxBackoffMs: 1000,
      });

      const result = await observer.pollOnce();

      expect(source.poll).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map((call) => call[0])).toEqual([100, 200]);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(boom);
      expect(result.ok).toBe(false);
      expect(result.attempts).toBe(3);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("caps a single backoff delay at maxBackoffMs", async () => {
      const source = { poll: jest.fn().mockRejectedValue(new Error("down")) };
      const { observer, sleep } = makeObserver(source, {
        maxRetries: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 150,
      });

      await observer.pollOnce();

      expect(sleep.mock.calls.map((call) => call[0])).toEqual([100, 150, 150]);
    });

    it("stops retrying once a retry succeeds and does not report an error", async () => {
      const source = {
        poll: jest
          .fn()
          .mockRejectedValueOnce(new Error("transient"))
          .mockResolvedValueOnce([{ id: "a" }]),
      };
      const { observer, onEvent, onError, sleep } = makeObserver(source);

      const result = await observer.pollOnce();

      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(2);
      expect(sleep.mock.calls.map((call) => call[0])).toEqual([100]);
      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    });

    it("treats a timed-out poll as failed", async () => {
      const source = { poll: jest.fn(() => new Promise(() => {})) };
      const { observer, onEvent, onError, timers } = makeObserver(source, {
        maxRetries: 0,
      });

      const pending = observer.pollOnce();
      expect(timers.timers).toHaveLength(1);
      expect(timers.timers[0].ms).toBe(1000);
      timers.fire(0);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].code).toBe(POLL_TIMEOUT);
      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe("start and stop", () => {
    it("stop prevents further polls", async () => {
      let observer;
      let polls = 0;
      const source = {
        poll: jest.fn(async () => {
          polls += 1;
          if (polls === 3) observer.stop();
          return [{ id: `e${polls}` }];
        }),
      };
      const made = makeObserver(source);
      observer = made.observer;

      await observer.start();

      expect(source.poll).toHaveBeenCalledTimes(3);
      expect(made.onEvent).toHaveBeenCalledTimes(3);
      expect(made.sleep.mock.calls).toEqual([[100], [100]]);
    });

    it("start after stop returns without polling", async () => {
      const source = { poll: jest.fn().mockResolvedValue([]) };
      const { observer } = makeObserver(source);

      observer.stop();
      await observer.start();

      expect(source.poll).not.toHaveBeenCalled();
    });

    it("stop during a backoff delay prevents the retry", async () => {
      let observer;
      const source = { poll: jest.fn().mockRejectedValue(new Error("down")) };
      const sleep = jest.fn(async () => {
        observer.stop();
      });
      const made = makeObserver(source, { sleep });
      observer = made.observer;

      const result = await observer.pollOnce();

      expect(source.poll).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
      expect(result.stopped).toBe(true);
      expect(made.onError).not.toHaveBeenCalled();
    });
  });
});
