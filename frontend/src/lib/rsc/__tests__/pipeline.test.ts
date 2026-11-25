import { createRscPipeline, rscFetch, resetRscPipeline } from "../pipeline";
import { getDashboardServerData, FALLBACK_WIDGETS } from "../server-data";
import { describeMigrationPlan, DASHBOARD_MIGRATION_PLAN, getMigrationStage } from "../boundaries";

describe("rsc pipeline", () => {
  beforeEach(() => {
    resetRscPipeline();
  });

  afterEach(() => {
    resetRscPipeline();
  });

  it("fetches data successfully", async () => {
    const result = await rscFetch(async () => ({ value: 42 }), {
      cacheKey: "test",
    });

    expect(result.data.value).toBe(42);
    expect(result.error).toBeNull();
    expect(result.fromCache).toBe(false);
  });

  it("returns fallback data on failure", async () => {
    const result = await rscFetch(
      async () => {
        throw new Error("Network error");
      },
      { fallbackData: { value: 0 }, cacheKey: "test-fallback" },
    );

    expect(result.data.value).toBe(0);
    expect(result.error).toBe("Network error");
    expect(result.fromCache).toBe(true);
  });

  it("retries failed fetches", async () => {
    let attempts = 0;
    const result = await rscFetch(
      async () => {
        attempts += 1;
        if (attempts < 2) throw new Error("Transient");
        return "ok";
      },
      { maxRetries: 3, cacheKey: "retry-test" },
    );

    expect(result.data).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("creates reusable pipeline instance", () => {
    const pipeline = createRscPipeline({ maxRetries: 1 });
    expect(pipeline.fetch).toBeDefined();
  });
});

describe("rsc server data", () => {
  it("returns dashboard widget data", async () => {
    const data = await getDashboardServerData();

    expect(data.widgets.length).toBeGreaterThan(0);
    expect(data.lastUpdated).toBeDefined();
  });

  it("provides fallback widgets", () => {
    expect(FALLBACK_WIDGETS.length).toBe(5);
  });
});

describe("rsc boundaries", () => {
  it("describes migration plan", () => {
    const description = describeMigrationPlan(DASHBOARD_MIGRATION_PLAN);
    expect(description).toContain("/dashboard");
    expect(description).toContain("DashboardClient");
  });

  it("returns migration stage for dashboard", () => {
    expect(getMigrationStage("/dashboard")).toBe("streaming");
  });
});
