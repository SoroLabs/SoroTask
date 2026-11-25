import {
  executeTerminalCommand,
  getTerminalCompletions,
  type TerminalApi,
} from "../commandEngine";
import type { Task } from "@/src/lib/mockApi/tasks";

const sampleTask: Task = {
  id: "task-1",
  contract: "CABCDEF",
  fn: "harvest",
  intervalSec: 3600,
  gas: 10,
  status: "pending",
  updatedAt: 1,
};

function createApi(): jest.Mocked<TerminalApi> {
  return {
    listTasks: jest.fn().mockResolvedValue([sampleTask]),
    createTask: jest.fn().mockResolvedValue(sampleTask),
    updateTask: jest.fn().mockResolvedValue(sampleTask),
    deleteTask: jest.fn().mockResolvedValue({ id: sampleTask.id }),
    simulate: jest.fn().mockResolvedValue("Simulation succeeded."),
  };
}

describe("SoroTask terminal command engine", () => {
  it("lists and pipes task output without invoking arbitrary commands", async () => {
    const api = createApi();

    const result = await executeTerminalCommand(
      "sorotask list | grep harvest | json",
      api,
    );

    expect(api.listTasks).toHaveBeenCalledTimes(1);
    expect(result.output).toEqual([
      JSON.stringify([sampleTask], null, 2),
    ]);
    await expect(
      executeTerminalCommand("sorotask list | node", api),
    ).rejects.toThrow('Unsupported pipe command "node"');
  });

  it("validates and creates task parameters", async () => {
    const api = createApi();
    await executeTerminalCommand(
      'sorotask create --contract CABCDEF --fn "harvest yield" --interval 3600 --gas 10',
      api,
    );

    expect(api.createTask).toHaveBeenCalledWith({
      contract: "CABCDEF",
      fn: "harvest yield",
      intervalSec: 3600,
      gas: 10,
    });
    await expect(
      executeTerminalCommand(
        "sorotask create --contract CABCDEF --fn harvest --interval 0 --gas 10",
        api,
      ),
    ).rejects.toThrow("--interval must be a positive number");
    expect(api.createTask).toHaveBeenCalledTimes(1);
  });

  it("preserves quoted pipe characters and rejects incomplete pipelines", async () => {
    const api = createApi();
    api.createTask.mockResolvedValue({ ...sampleTask, fn: "swap|claim" });

    await executeTerminalCommand(
      'sorotask create --contract CABCDEF --fn "swap|claim" --interval 60 --gas 1',
      api,
    );

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ fn: "swap|claim" }),
    );
    await expect(
      executeTerminalCommand("sorotask list |", api),
    ).rejects.toThrow("Each side of a pipe must be a command.");
  });

  it("supports command completion and exposes wallet simulation errors", async () => {
    const api = createApi();
    api.simulate.mockRejectedValue(new Error("wallet disconnected"));

    expect(getTerminalCompletions("sorotask l")).toEqual(["sorotask list"]);
    await expect(
      executeTerminalCommand(
        "sorotask simulate --contract CABCDEF --fn harvest",
        api,
      ),
    ).rejects.toThrow("wallet disconnected");
  });
});
