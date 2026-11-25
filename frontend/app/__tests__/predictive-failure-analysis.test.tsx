/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "../page";
import PredictiveFailureAnalysisPanel from "../components/PredictiveFailureAnalysisPanel";

const prediction = {
  riskScore: 86,
  riskLevel: "critical" as const,
  confidence: "low" as const,
  summary: "Highly likely to fail unless adjusted.",
  evidence: {
    gasShortfall: true,
    intervalTooFast: true,
    contractReputation: "Unknown contract profile.",
  },
};

describe("Predictive Failure Analysis UI", () => {
  it("renders the risk badge and evidence summary for a critical prediction", () => {
    render(<PredictiveFailureAnalysisPanel status="success" prediction={prediction} />);

    expect(screen.getByText(/execution failure risk/i)).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
    expect(screen.getByText(/potential shortage/i)).toBeInTheDocument();
    expect(screen.getByText(/too frequent/i)).toBeInTheDocument();
  });

  it("shows a predictive panel when rendering with prediction state", () => {
    render(<PredictiveFailureAnalysisPanel status="success" prediction={prediction} />);
    expect(screen.getByText(/execution failure risk/i)).toBeInTheDocument();
    expect(screen.getByText(/highly likely to fail/i)).toBeInTheDocument();
  });
});
