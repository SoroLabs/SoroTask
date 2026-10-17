import { fireEvent, render, screen } from "@testing-library/react";
import {
  createSandboxedPluginComponent,
  resolvePluginEntry,
} from "../../pluginRuntime";
import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  id: "analytics-widget",
  name: "Analytics Widget",
  version: "1.0.0",
  entry: "https://plugins.example.com/analytics/",
  scope: "dashboard",
};

describe("sandboxed plugin runtime", () => {
  it("requires external origins to be explicitly trusted", () => {
    expect(() => resolvePluginEntry(manifest.entry)).toThrow("not trusted");
    expect(resolvePluginEntry(manifest.entry, ["https://plugins.example.com"])).toBe(
      manifest.entry,
    );
  });

  it("rejects insecure external origins and URL credentials", () => {
    expect(() => resolvePluginEntry("http://plugins.example.com/plugin/")).toThrow(
      "HTTPS",
    );
    const credentialedUrl = new URL("https://plugins.example.com/plugin/");
    credentialedUrl.username = "developer";
    expect(() =>
      resolvePluginEntry(credentialedUrl.href, ["https://plugins.example.com"]),
    ).toThrow("credentials");
  });

  it("renders plugins in an opaque-origin iframe without extra sandbox privileges", () => {
    const Plugin = createSandboxedPluginComponent(manifest, {
      trustedOrigins: ["https://plugins.example.com"],
    });

    render(<Plugin pluginId={manifest.id} />);

    const frame = screen.getByTestId("plugin-frame-analytics-widget");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveAttribute("src", manifest.entry);
  });

  it("sends only bounded context after a matching iframe handshake", () => {
    const Plugin = createSandboxedPluginComponent(manifest, {
      trustedOrigins: ["https://plugins.example.com"],
    });
    render(
      <Plugin
        pluginId={manifest.id}
        context={{ workspaceId: "workspace-1" }}
      />,
    );

    const frame = screen.getByTestId("plugin-frame-analytics-widget");
    const contentWindow = frame.contentWindow;
    if (!contentWindow) {
      throw new Error("Expected plugin iframe contentWindow");
    }
    const postMessage = jest.spyOn(contentWindow, "postMessage");

    const message = {
      type: "SOROTASK_PLUGIN_READY",
      pluginId: manifest.id,
      version: manifest.version,
    };
    fireEvent(
      window,
      new MessageEvent("message", {
        data: message,
        origin: "null",
        source: window,
      }),
    );
    expect(postMessage).not.toHaveBeenCalled();

    fireEvent(
      window,
      new MessageEvent("message", {
        data: message,
        origin: "null",
        source: contentWindow,
      }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "SOROTASK_PLUGIN_INIT",
        pluginId: manifest.id,
        version: manifest.version,
        context: { workspaceId: "workspace-1" },
      },
      "*",
    );
  });
});
