import {
  createPluginRegistry,
  getPluginRegistry,
  resetPluginRegistry,
} from "../registry";
import type { PluginManifest } from "../types";

const sampleManifest: PluginManifest = {
  id: "analytics-widget",
  name: "Analytics Widget",
  version: "1.0.0",
  entry: "/plugins/analytics/index.js",
  scope: "dashboard",
};

describe("plugin registry", () => {
  beforeEach(() => {
    window.__SOROTASK_PLUGIN_REGISTRY__ = [];
    resetPluginRegistry();
  });

  afterEach(() => {
    resetPluginRegistry();
  });

  it("registers and retrieves plugins", () => {
    const registry = createPluginRegistry();
    const entry = registry.register(sampleManifest);

    expect(entry.id).toBe("analytics-widget");
    expect(entry.enabled).toBe(true);
    expect(registry.get("analytics-widget")).toEqual(entry);
  });

  it("lists enabled plugins only", () => {
    const registry = createPluginRegistry();
    registry.register(sampleManifest);
    registry.register({ ...sampleManifest, id: "disabled-plugin" });
    registry.setEnabled("disabled-plugin", false);

    expect(registry.list()).toHaveLength(2);
    expect(registry.list({ enabledOnly: true })).toHaveLength(1);
  });

  it("finds plugins by scope", () => {
    const registry = createPluginRegistry();
    registry.register(sampleManifest);
    registry.register({
      ...sampleManifest,
      id: "settings-panel",
      scope: "settings",
    });

    expect(registry.findByScope("dashboard")).toHaveLength(1);
    expect(registry.findByScope("dashboard")[0].id).toBe("analytics-widget");
  });

  it("unregisters plugins", () => {
    const registry = createPluginRegistry();
    registry.register(sampleManifest);

    expect(registry.unregister("analytics-widget")).toBe(true);
    expect(registry.get("analytics-widget")).toBeUndefined();
  });

  it("reuses singleton registry", () => {
    const first = getPluginRegistry();
    const second = getPluginRegistry();

    first.register(sampleManifest);
    expect(second.get("analytics-widget")).toBeDefined();
  });
});
