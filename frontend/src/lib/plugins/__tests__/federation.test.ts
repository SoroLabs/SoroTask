import {
  initializeModuleFederation,
  resetModuleFederation,
} from "../federation";
import type { PluginManifest } from "../types";

const sampleManifest: PluginManifest = {
  id: "task-widget",
  name: "Task Widget",
  version: "1.0.0",
  entry: "/plugins/task/index.js",
  scope: "dashboard",
};

describe("module federation", () => {
  beforeEach(() => {
    resetModuleFederation();
  });

  afterEach(() => {
    resetModuleFederation();
  });

  it("initializes registry and loader", () => {
    const federation = initializeModuleFederation({
      plugins: [sampleManifest],
    });

    expect(federation.listPlugins()).toHaveLength(1);
    expect(federation.registry.get("task-widget")).toBeDefined();
  });

  it("registers plugins at runtime", () => {
    const federation = initializeModuleFederation();

    const entry = federation.registerPlugin(sampleManifest);
    expect(entry.id).toBe("task-widget");
    expect(federation.listPlugins()).toHaveLength(1);
  });
});
