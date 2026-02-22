import { retry } from "./retry.js";

export function createExecutor({ logger }) {
  return {
    async execute(task) {
      await retry(async () => {
        logger.info("Executing task", { task });
        // TODO: build and submit Soroban transaction
      });
    },
  };
}
