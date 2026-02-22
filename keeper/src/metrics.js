export function createMetrics() {
  let executed = 0;

  return {
    incrementExecuted: () => executed++,
    get: () => ({ executed }),
  };
}
