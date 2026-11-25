import { PredictionEngine } from "../prediction-engine";
import { DEFAULT_PREFETCH_CONFIG } from "../types";

describe("PredictionEngine", () => {
  let engine: PredictionEngine;

  beforeEach(() => {
    engine = new PredictionEngine(DEFAULT_PREFETCH_CONFIG);
  });

  it("returns empty when no current route", () => {
    const result = engine.predict({}, null);
    expect(result.predictions).toEqual([]);
    expect(result.currentRoute).toBe("");
  });

  it("returns empty when no transitions exist", () => {
    const result = engine.predict({}, "/dashboard");
    expect(result.predictions).toEqual([]);
    expect(result.currentRoute).toBe("/dashboard");
  });

  it("returns empty when current route has no outgoing transitions", () => {
    const matrix = {
      "/dashboard": { "/tasks": 5 },
    };
    const result = engine.predict(matrix, "/settings");
    expect(result.predictions).toEqual([]);
  });

  it("predicts most likely next route", () => {
    const matrix = {
      "/dashboard": { "/tasks": 10, "/settings": 2 },
    };
    const result = engine.predict(matrix, "/dashboard");
    expect(result.predictions.length).toBe(2);
    expect(result.predictions[0].route).toBe("/tasks");
    expect(result.predictions[0].probability).toBeCloseTo(10 / 12, 4);
  });

  it("filters predictions below min probability", () => {
    const config = { ...DEFAULT_PREFETCH_CONFIG, minProbability: 0.2 };
    const engine = new PredictionEngine(config);
    const matrix = {
      "/dashboard": { "/tasks": 9, "/settings": 1 },
    };
    const result = engine.predict(matrix, "/dashboard");
    expect(result.predictions.length).toBe(1);
    expect(result.predictions[0].route).toBe("/tasks");
  });

  it("limits predictions by maxPredictions", () => {
    const config = { ...DEFAULT_PREFETCH_CONFIG, minProbability: 0.01 };
    const engine = new PredictionEngine(config);
    const matrix = {
      "/dashboard": { "/a": 5, "/b": 4, "/c": 3, "/d": 2, "/e": 1, "/f": 1 },
    };
    const result = engine.predict(matrix, "/dashboard");
    expect(result.predictions.length).toBe(5);
  });

  it("sorts predictions by probability descending", () => {
    const config = { ...DEFAULT_PREFETCH_CONFIG, minProbability: 0 };
    const engine = new PredictionEngine(config);
    const matrix = {
      "/dashboard": { "/low": 1, "/high": 10, "/medium": 5 },
    };
    const result = engine.predict(matrix, "/dashboard");
    expect(result.predictions[0].route).toBe("/high");
    expect(result.predictions[1].route).toBe("/medium");
    expect(result.predictions[2].route).toBe("/low");
  });

  it("calculates confidence values within [0, 1]", () => {
    const matrix = {
      "/dashboard": { "/tasks": 10, "/settings": 5 },
    };
    const result = engine.predict(matrix, "/dashboard");
    for (const prediction of result.predictions) {
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("reports total and unique transition counts", () => {
    const matrix = {
      "/a": { "/b": 5, "/c": 3 },
      "/b": { "/a": 2 },
    };
    const result = engine.predict(matrix, "/a");
    expect(result.totalTransitions).toBe(10);
    expect(result.uniqueTransitions).toBe(3);
  });

  it("returns computed timestamp", () => {
    const matrix = {
      "/dashboard": { "/tasks": 5 },
    };
    const before = Date.now();
    const result = engine.predict(matrix, "/dashboard");
    expect(result.computedAt).toBeGreaterThanOrEqual(before);
    expect(result.computedAt).toBeLessThanOrEqual(Date.now());
  });

  it("produces valid prediction summary", () => {
    const matrix = {
      "/dashboard": { "/tasks": 10, "/settings": 5, "/profile": 2 },
    };
    const result = engine.predict(matrix, "/dashboard");
    const summary = engine.getPredictionSummary(result.predictions);
    expect(summary).toContain("/tasks");
    expect(summary).toContain("/settings");
    expect(summary).toContain("%");
  });

  it("returns no predictions available for empty", () => {
    const summary = engine.getPredictionSummary([]);
    expect(summary).toBe("No predictions available");
  });
});
