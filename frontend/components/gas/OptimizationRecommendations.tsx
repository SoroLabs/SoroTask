/**
 * Optimization Recommendations Component
 * 
 * Displays gas fee optimization recommendations with actionable insights.
 */

'use client';

import React from 'react';
import { OptimizationRecommendation } from '@/types/gas';

interface OptimizationRecommendationsProps {
  recommendations: OptimizationRecommendation[];
  onApplyRecommendation?: (recommendation: OptimizationRecommendation) => void;
  className?: string;
}

export function OptimizationRecommendations({
  recommendations,
  onApplyRecommendation,
  className = '',
}: OptimizationRecommendationsProps) {
  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatSavings = (savings: number) => {
    return savings.toLocaleString() + ' stroops';
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const hours = Math.floor((timestamp - now.getTime()) / (1000 * 60 * 60));
    
    if (hours < 1) return 'Soon';
    if (hours < 24) return `In ${hours}h`;
    return date.toLocaleDateString();
  };

  if (recommendations.length === 0) {
    return (
      <div className={`bg-gray-50 rounded-lg p-6 text-center ${className}`}>
        <p className="text-gray-500">No optimization recommendations available</p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Optimization Recommendations
      </h3>
      
      {recommendations.map((rec, index) => (
        <div
          key={index}
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`px-2 py-1 rounded text-xs font-medium border ${getRiskColor(
                    rec.riskLevel
                  )}`}
                >
                  {rec.riskLevel.toUpperCase()} RISK
                </span>
                <span className="text-sm text-gray-500">
                  Confidence: {Math.round(rec.confidence * 100)}%
                </span>
              </div>
              
              <p className="text-gray-900 font-medium mb-1">{rec.reason}</p>
              
              {rec.estimatedSavings > 0 && (
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-green-600 font-semibold">
                    Save {formatSavings(rec.estimatedSavings)}
                  </span>
                  <span className="text-green-600">
                    ({rec.savingsPercentage.toFixed(1)}%)
                  </span>
                </div>
              )}
              
              {rec.recommendedBalance && (
                <div className="mt-2 text-sm">
                  <span className="text-gray-600">Recommended balance: </span>
                  <span className="font-semibold text-gray-900">
                    {rec.recommendedBalance.toLocaleString()} stroops
                  </span>
                </div>
              )}
            </div>
            
            {onApplyRecommendation && (
              <button
                onClick={() => onApplyRecommendation(rec)}
                className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                Apply
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-4 text-xs text-gray-500 pt-3 border-t border-gray-100">
            <div>
              <span className="font-medium">Current:</span>{' '}
              {formatTime(rec.currentExecutionTime)}
            </div>
            {rec.recommendedExecutionTime !== rec.currentExecutionTime && (
              <div>
                <span className="font-medium">Recommended:</span>{' '}
                {formatTime(rec.recommendedExecutionTime)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
