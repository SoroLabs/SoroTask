import { createRegistry } from "./registry.js";
import { createExecutor } from "./executor.js";
import { ExecutionQueue } from "./queue.js";

export function createPoller({ config, logger }) {
  const registry = createRegistry();
  const executor = createExecutor({ logger });

  const queue = new ExecutionQueue(process.env.MAX_CONCURRENT_EXECUTIONS);

  let intervalId = null;

  // Wire queue events to logger
  queue.on("task:started", (taskId) => logger.info("Task started", { taskId }));

  queue.on("task:success", (taskId) =>
    logger.info("Task succeeded", { taskId }),
  );

  queue.on("task:failed", (taskId, error) =>
    logger.error("Task failed", { taskId, error: error.message }),
  );

  queue.on("cycle:complete", (stats) =>
    logger.info("Execution cycle complete", stats),
  );

  async function poll() {
    logger.info("Checking for due tasks...");

    // TODO: Replace with real contract query
    // const dueTaskIds = await getDueTasksFromContract();

    const dueTaskIds = [Date.now()]; // mock

    const newTaskIds = dueTaskIds.filter((id) => !registry.has(id));

    newTaskIds.forEach((id) => registry.add(id));

    if (newTaskIds.length > 0) {
      await queue.enqueue(newTaskIds, async (taskId) => {
        await executor.execute({ id: taskId });
      });
    }
  }

  function start() {
    intervalId = setInterval(poll, config.pollIntervalMs);
  }

  async function stop() {
    if (intervalId) {
      clearInterval(intervalId);
    }

    await queue.drain();
  }

  return { start, stop };
}
