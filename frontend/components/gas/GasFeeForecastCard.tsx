/**
 * Gas Fee Forecast Card Component
 * 
 * Displays gas fee forecast information for a task including
 * estimated costs, confidence levels, and underfunded warnings.
 */

'use client';

import React from 'react';
import { GasFeeForecast } from '@/types/gas';

interface GasFeeForecastCardProps {
  forecast: GasFeeForecast;
  className?: string;
}

export function GasFeeForecastCard({ forecast, className = '' }: GasFeeForecastCardProps) {
  const getConfidenceColor = (confidence: string) => {
    return confidence === 'high' ? 'text-green-600' : 'text-yellow-600';
  };

  const getConfidenceBg = (confidence: string) => {
    return confidence === 'high' ? 'bg-green-100' : 'bg-yellow-100';
  };

  const formatStroops = (value: number | null) => {
    if (value === null) return 'N/A';
    return value.toLocaleString();
  };

  const formatXLM = (stroops: number | null) => {
    if (stroops === null) return 'N/A';
    return (stroops / 10000000).toFixed(7) + ' XLM';
  };

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Gas Fee Forecast</h3>
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium ${getConfidenceBg(
            forecast.confidence
          )} ${getConfidenceColor(forecast.confidence)}`}
        >
          {forecast.confidence} confidence
        </span>
      </div>

      <div className="space-y-4">
        {/* Estimated Cost */}
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Estimated Cost</span>
          <div className="text-right">
            <span className="text-2xl font-bold text-gray-900">
              {formatStroops(forecast.estimatedCost)}
            </span>
            <span className="text-sm text-gray-500 ml-2">
              {formatXLM(forecast.estimatedCost)}
            </span>
          </div>
        </div>

        {/* Historical Samples */}
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Historical Samples</span>
          <span className="font-medium text-gray-900">{forecast.historicalSamples}</span>
        </div>

        {/* Recommended Balance */}
        {forecast.recommendedBalance && (
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Recommended Balance</span>
            <div className="text-right">
              <span className="font-medium text-gray-900">
                {formatStroops(forecast.recommendedBalance)}
              </span>
              <span className="text-sm text-gray-500 ml-2">
                {formatXLM(forecast.recommendedBalance)}
              </span>
            </div>
          </div>
        )}

        {/* Buffer */}
        {forecast.buffer && (
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Safety Buffer</span>
            <span className="font-medium text-gray-900">
              {formatStroops(forecast.buffer)}
            </span>
          </div>
        )}

        {/* Underfunded Warning */}
        {forecast.isUnderfunded && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center">
              <svg
                className="w-5 h-5 text-red-600 mr-2"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-red-800 font-medium">
                Task is underfunded
              </span>
            </div>
            <p className="text-sm text-red-700 mt-1">
              Current gas balance may be insufficient for reliable execution.
            </p>
          </div>
        )}

        {/* Reason */}
        <div className="pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            <span className="font-medium">Reason:</span> {forecast.reason}
          </p>
        </div>

        {/* Statistics */}
        {forecast.stats && (
          <div className="pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Statistics</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Mean:</span>{' '}
                <span className="font-medium">{formatStroops(forecast.stats.mean)}</span>
              </div>
              <div>
                <span className="text-gray-500">Median:</span>{' '}
                <span className="font-medium">{formatStroops(forecast.stats.median)}</span>
              </div>
              <div>
                <span className="text-gray-500">P95:</span>{' '}
                <span className="font-medium">{formatStroops(forecast.stats.p95)}</span>
              </div>
              <div>
                <span className="text-gray-500">P99:</span>{' '}
                <span className="font-medium">{formatStroops(forecast.stats.p99)}</span>
              </div>
              <div>
                <span className="text-gray-500">Min:</span>{' '}
                <span className="font-medium">{formatStroops(forecast.stats.min)}</span>
              </div>
              <div>
                <span className="text-gray-500">Max:</span>{' '}
                <span className="font-medium">{formatStroops(forecast.stats.max)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
