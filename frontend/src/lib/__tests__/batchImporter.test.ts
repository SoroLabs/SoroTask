import {
  importAndValidatePreset,
  simulateBatchCreation,
  executeBatchRegistration,
  exportTasksToJSON,
  exportTasksToYAML,
  exportTasksToCSV,
  TaskPreset,
} from "../batchImporter";

describe("Batch Task Configuration Importer/Exporter — FE-PROD-24", () => {
  it("imports and validates 100+ tasks in < 1 second (< 1000ms)", () => {
    const hundredTasks: TaskPreset[] = Array.from({ length: 100 }, (_, i) => ({
      name: `Automated Vault Rebalance Task #${i + 1}`,
      contractAddress: `CA3D5KRYMCMUG7OWCT7YGONR${i.toString().padStart(4, "0")}`,
      functionName: "rebalance_vault",
      gasLimit: 150000 + i * 10,
      schedule: "0 */6 * * *",
    }));

    const jsonContent = JSON.stringify(hundredTasks);
    const result = importAndValidatePreset(jsonContent, "json");

    expect(result.totalCount).toBe(100);
    expect(result.validCount).toBe(100);
    expect(result.errors).toHaveLength(0);
    expect(result.durationMs).toBeLessThan(1000); // < 1s acceptance criteria
  });

  it("highlights invalid entries with exact line numbers for JSON", () => {
    const invalidJson = `[
  {
    "name": "Valid Task 1",
    "contractAddress": "CA3D5KRYMCMUG7OWCT7YGONR",
    "functionName": "rebalance",
    "gasLimit": 5000,
    "schedule": "0 * * * *"
  },
  {
    "name": "Invalid Task 2",
    "contractAddress": "",
    "functionName": "rebalance",
    "gasLimit": -10,
    "schedule": ""
  }
]`;

    const result = importAndValidatePreset(invalidJson, "json");
    expect(result.totalCount).toBe(2);
    expect(result.validCount).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);

    // Exact line number identification for second item
    const lineNumbers = result.errors.map((e) => e.line);
    expect(lineNumbers).toContain(10);
  });

  it("parses and validates YAML presets with line numbers", () => {
    const yamlContent = `
- name: "Harvest Yield"
  contractAddress: "CA3D5KRYMCMUG7OWCT7YGONR"
  functionName: "harvest"
  gasLimit: 100000
  schedule: "0 0 * * *"

- name: ""
  contractAddress: "CA3D5KRYMCMUG7OWCT7YGONR"
  functionName: "swap"
  gasLimit: 50000
  schedule: "0 12 * * *"
`;

    const result = importAndValidatePreset(yamlContent, "yaml");
    expect(result.totalCount).toBe(2);
    expect(result.validCount).toBe(1);
    expect(result.errors[0].field).toBe("name");
    expect(result.errors[0].line).toBe(8);
  });

  it("parses and validates CSV presets with line numbers", () => {
    const csvContent = `name,contractAddress,functionName,gasLimit,schedule
"Task One","CA3D5KRYMCMUG7OWCT7YGONR","run",50000,"0 * * * *"
"Task Two","","run",50000,"0 * * * *"`;

    const result = importAndValidatePreset(csvContent, "csv");
    expect(result.totalCount).toBe(2);
    expect(result.validCount).toBe(1);
    expect(result.errors[0].field).toBe("contractAddress");
    expect(result.errors[0].line).toBe(3);
  });

  it("simulates batch pre-flight dry-run and executes in single multi-call", async () => {
    const tasks: TaskPreset[] = [
      {
        name: "Task A",
        contractAddress: "CA3D5KRYMCMUG7OWCT7YGONR",
        functionName: "step_one",
        gasLimit: 80000,
        schedule: "*/15 * * * *",
      },
      {
        name: "Task B",
        contractAddress: "CB4E6LSZNDNVH8PXD8ZHPOOS",
        functionName: "step_two",
        gasLimit: 120000,
        schedule: "0 0 * * *",
      },
    ];

    const simulation = await simulateBatchCreation(tasks);
    expect(simulation.success).toBe(true);
    expect(simulation.simulatedCount).toBe(2);
    expect(simulation.estimatedGasTotal).toBe(200000);

    const execution = await executeBatchRegistration(tasks);
    expect(execution.createdCount).toBe(2);
    expect(execution.txHash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("supports exporting to JSON, YAML, and CSV", () => {
    const tasks: TaskPreset[] = [
      {
        name: "Exported Task",
        contractAddress: "CA3D5KRYMCMUG7OWCT7YGONR",
        functionName: "execute",
        gasLimit: 100000,
        schedule: "0 * * * *",
      },
    ];

    const json = exportTasksToJSON(tasks);
    expect(json).toContain("Exported Task");

    const yaml = exportTasksToYAML(tasks);
    expect(yaml).toContain('- name: "Exported Task"');

    const csv = exportTasksToCSV(tasks);
    expect(csv).toContain('"Exported Task","CA3D5KRYMCMUG7OWCT7YGONR"');
  });
});
