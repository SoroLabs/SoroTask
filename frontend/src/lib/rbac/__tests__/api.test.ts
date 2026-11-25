import { createRbacApi, resetRbacApi } from "../api";

describe("rbac api", () => {
  beforeEach(() => {
    resetRbacApi();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    resetRbacApi();
    jest.restoreAllMocks();
  });

  it("returns cached permissions when API URL is not configured", async () => {
    const api = createRbacApi({ baseUrl: "" });
    const result = await api.fetchPermissions("user-1");

    expect(result.connectionState).toBe("offline");
    expect(result.data).toBeNull();
  });

  it("fetches permissions successfully", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ["tasks:read", "tasks:create"],
    });

    const api = createRbacApi({ baseUrl: "http://localhost:3000" });
    const result = await api.fetchPermissions("user-1");

    expect(result.data).toEqual(["tasks:read", "tasks:create"]);
    expect(result.connectionState).toBe("online");
    expect(result.fromCache).toBe(false);
  });

  it("falls back to cache on network failure", async () => {
    const api = createRbacApi({ baseUrl: "http://localhost:3000", cacheKey: "test_rbac" });
    api.writeCache("test_rbac:permissions:user-1", ["tasks:read"]);

    (global.fetch as jest.Mock).mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await api.fetchPermissions("user-1");

    expect(result.fromCache).toBe(true);
    expect(result.connectionState).toBe("offline");
    expect(result.data).toEqual(["tasks:read"]);
  });

  it("queues workspace sync offline", async () => {
    const api = createRbacApi({ baseUrl: "" });
    const result = await api.syncWorkspace("ws-1", { name: "Test" });

    expect(result.data?.success).toBe(true);
    expect(result.fromCache).toBe(true);
  });
});
