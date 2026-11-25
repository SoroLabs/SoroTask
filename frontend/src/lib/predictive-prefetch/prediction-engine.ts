import type { PrefetchConfig, Prediction, PredictionResult, TransitionMatrix } from "./types";

export class PredictionEngine {
  private config: PrefetchConfig;

  constructor(config: PrefetchConfig) {
    this.config = config;
  }

  predict(matrix: TransitionMatrix, currentRoute: string | null): PredictionResult {
    const now = Date.now();
    let totalTransitions = 0;
    let uniqueTransitions = 0;

    for (const tos of Object.values(matrix)) {
      for (const count of Object.values(tos)) {
        totalTransitions += count;
        uniqueTransitions++;
      }
    }

    if (!currentRoute || totalTransitions === 0) {
      return {
        predictions: [],
        currentRoute: currentRoute ?? "",
        computedAt: now,
        totalTransitions,
        uniqueTransitions,
      };
    }

    const outgoing = matrix[currentRoute];
    if (!outgoing || Object.keys(outgoing).length === 0) {
      return {
        predictions: [],
        currentRoute,
        computedAt: now,
        totalTransitions,
        uniqueTransitions,
      };
    }

    const totalOutgoing = Object.values(outgoing).reduce((sum, count) => sum + count, 0);

    const rawPredictions: Prediction[] = Object.entries(outgoing)
      .map(([route, count]) => {
        const probability = totalOutgoing > 0 ? count / totalOutgoing : 0;
        return {
          route,
          probability,
          confidence: this.calculateConfidence(route, matrix, currentRoute, totalOutgoing),
        };
      })
      .filter((p) => p.probability >= this.config.minProbability)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, this.config.maxPredictions);

    return {
      predictions: rawPredictions,
      currentRoute,
      computedAt: now,
      totalTransitions,
      uniqueTransitions,
    };
  }

  private calculateConfidence(
    targetRoute: string,
    matrix: TransitionMatrix,
    currentRoute: string,
    totalOutgoing: number,
  ): number {
    const outgoing = matrix[currentRoute];
    if (!outgoing) return 0;

    const directCount = outgoing[targetRoute] || 0;
    const directProb = totalOutgoing > 0 ? directCount / totalOutgoing : 0;

    const globalMatrix = this.getGlobalProbabilities(matrix);
    const globalProb = globalMatrix[targetRoute] || 0;

    const recencyBoost = this.calculateRecencyBoost(matrix, currentRoute, targetRoute);

    const confidence = directProb * 0.6 + globalProb * 0.2 + recencyBoost * 0.2;

    return Math.min(1, Math.max(0, Number(confidence.toFixed(4))));
  }

  private getGlobalProbabilities(matrix: TransitionMatrix): Record<string, number> {
    const destCounts: Record<string, number> = {};
    let totalDestinations = 0;

    for (const tos of Object.values(matrix)) {
      for (const [dest, count] of Object.entries(tos)) {
        destCounts[dest] = (destCounts[dest] || 0) + count;
        totalDestinations += count;
      }
    }

    const result: Record<string, number> = {};
    for (const [dest, count] of Object.entries(destCounts)) {
      result[dest] = totalDestinations > 0 ? count / totalDestinations : 0;
    }

    return result;
  }

  private calculateRecencyBoost(
    matrix: TransitionMatrix,
    currentRoute: string,
    targetRoute: string,
  ): number {
    const outgoing = matrix[currentRoute];
    if (!outgoing) return 0;

    const recentTransitions: Array<{ route: string; count: number }> = Object.entries(outgoing)
      .filter(([route]) => route !== targetRoute)
      .map(([route, count]) => ({ route, count }));

    if (recentTransitions.length === 0) return 0;

    recentTransitions.sort((a, b) => b.count - a.count);
    const topCount = recentTransitions[0].count;
    if (topCount === 0) return 0;

    const targetCount = outgoing[targetRoute] || 0;
    return Math.min(1, targetCount / topCount);
  }

  getPredictionSummary(predictions: Prediction[]): string {
    if (predictions.length === 0) return "No predictions available";
    return predictions
      .slice(0, 3)
      .map((p) => `${p.route} (${(p.probability * 100).toFixed(0)}%)`)
      .join(", ");
  }
}
