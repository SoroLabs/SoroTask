import type { PrefetchConfig, TransitionMatrix } from "./types";
import { PredictionEngine } from "./prediction-engine";

interface WorkerMessage {
  id: string;
  type: "predict";
  data: {
    matrix: TransitionMatrix;
    currentRoute: string | null;
    config: PrefetchConfig;
  };
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { id, type, data } = event.data;

  if (type === "predict") {
    try {
      const engine = new PredictionEngine(data.config);
      const result = engine.predict(data.matrix, data.currentRoute);
      self.postMessage({ id, type: "prediction-result", data: result });
    } catch (error) {
      self.postMessage({
        id,
        type: "prediction-error",
        data: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }
  }
};
