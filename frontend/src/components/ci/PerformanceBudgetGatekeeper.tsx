import React, { useState, useEffect } from 'react';

interface PerformanceMetrics {
  fcp: number;
  lcp: number;
  fid: number;
  cls: number;
  bundleSize: number;
}

interface PerformanceBudgetGatekeeperProps {
  thresholds: PerformanceMetrics;
  currentMetrics: PerformanceMetrics;
  onApprove: () => void;
  onReject: (reasons: string[]) => void;
}

export const PerformanceBudgetGatekeeper: React.FC<PerformanceBudgetGatekeeperProps> = ({
  thresholds,
  currentMetrics,
  onApprove,
  onReject,
}) => {
  const [violations, setViolations] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const checkMetrics = () => {
      setIsProcessing(true);
      const newViolations: string[] = [];
      
      if (currentMetrics.fcp > thresholds.fcp) newViolations.push(`FCP exceeds limit: ${currentMetrics.fcp} > ${thresholds.fcp}`);
      if (currentMetrics.lcp > thresholds.lcp) newViolations.push(`LCP exceeds limit: ${currentMetrics.lcp} > ${thresholds.lcp}`);
      if (currentMetrics.fid > thresholds.fid) newViolations.push(`FID exceeds limit: ${currentMetrics.fid} > ${thresholds.fid}`);
      if (currentMetrics.cls > thresholds.cls) newViolations.push(`CLS exceeds limit: ${currentMetrics.cls} > ${thresholds.cls}`);
      if (currentMetrics.bundleSize > thresholds.bundleSize) newViolations.push(`Bundle size exceeds limit: ${currentMetrics.bundleSize} > ${thresholds.bundleSize}`);

      setViolations(newViolations);
      setIsProcessing(false);
    };

    checkMetrics();
  }, [currentMetrics, thresholds]);

  const handleAction = () => {
    if (violations.length === 0) {
      onApprove();
    } else {
      onReject(violations);
    }
  };

  return (
    <div className="performance-gatekeeper p-6 bg-gray-900 text-white rounded-xl shadow-lg border border-gray-700">
      <h2 className="text-2xl font-bold mb-4">Performance Budget CI/CD Gatekeeper</h2>
      
      {isProcessing ? (
        <p>Analyzing metrics against budget...</p>
      ) : (
        <div className="metrics-results">
          {violations.length > 0 ? (
            <div className="bg-red-900/50 border border-red-500 p-4 rounded-md mb-4">
              <h3 className="text-red-400 font-semibold mb-2">Budget Violations Detected</h3>
              <ul className="list-disc pl-5">
                {violations.map((v, i) => (
                  <li key={i} className="text-red-200">{v}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="bg-green-900/50 border border-green-500 p-4 rounded-md mb-4">
              <h3 className="text-green-400 font-semibold">All performance budgets met!</h3>
            </div>
          )}
          
          <button 
            onClick={handleAction}
            className={`px-4 py-2 rounded font-medium transition-colors ${violations.length > 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {violations.length > 0 ? 'Reject Build' : 'Approve Build'}
          </button>
        </div>
      )}
    </div>
  );
};
