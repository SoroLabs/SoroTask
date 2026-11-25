import { exportToJson, exportToTerraform, ExportTaskConfig } from "../taskExporter";

const sampleTasks: ExportTaskConfig[] = [
  {
    id: "task-1",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    functionName: "harvest",
    schedule: "0 0 * * *",
    network: "testnet",
  },
];

describe("Task IaC Exporter", () => {
  it("exports valid JSON with version and tasks array", () => {
    const jsonStr = exportToJson(sampleTasks);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].id).toBe("task-1");
  });

  it("exports valid Terraform resource blocks", () => {
    const tfStr = exportToTerraform(sampleTasks);
    expect(tfStr).toContain('resource "sorotask_scheduled_job" "task_1"');
    expect(tfStr).toContain('contract_id   = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"');
    expect(tfStr).toContain('function_name = "harvest"');
  });
});
