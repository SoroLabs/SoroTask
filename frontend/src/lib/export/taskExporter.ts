export interface ExportTaskConfig {
  id: string;
  contractId: string;
  functionName: string;
  schedule: string;
  network?: string;
  gasLimit?: number;
  maxRetries?: number;
}

export function exportToJson(tasks: ExportTaskConfig[]): string {
  return JSON.stringify({ version: "1.0.0", tasks }, null, 2);
}

export function exportToTerraform(tasks: ExportTaskConfig[]): string {
  return tasks
    .map((task) => {
      const resourceName = task.id.replace(/[^a-zA-Z0-9_]/g, "_");
      return `resource "sorotask_scheduled_job" "${resourceName}" {
  contract_id   = "${task.contractId}"
  function_name = "${task.functionName}"
  schedule      = "${task.schedule}"
  network       = "${task.network || "testnet"}"
  gas_limit     = ${task.gasLimit || 1000000}
  max_retries   = ${task.maxRetries || 3}
}`;
    })
    .join("\n\n");
}
