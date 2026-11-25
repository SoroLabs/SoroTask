/**
 * Gas Price Trend Indicator Component
 * 
 * Visual indicator showing current gas price trends and multipliers.
 */

'use client';

import React from 'react';
import { GasPriceTrend } from '@/types/gas';

interface GasPriceTrendIndicatorProps {
  trend: GasPriceTrend;
  className?: string;
}

export function GasPriceTrendIndicator({ trend, className = '' }: GasPriceTrendIndicatorProps) {
  const getTrendColor = (trendValue: number) => {
    if (trendValue > 0.1) return 'text-red-600';
    if (trendValue < -0.1) return 'text-green-600';
    return 'text-gray-600';
  };

  const getTrendIcon = (trendValue: number) => {
    if (trendValue > 0.1) {
      return (
        <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      );
    }
    if (trendValue < -0.1) {
      return (
        <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
      </svg>
    );
  };

  const getMultiplierColor = (multiplier: number) => {
    if (multiplier > 1.3) return 'bg-red-100 text-red-800';
    if (multiplier > 1.1) return 'bg-yellow-100 text-yellow-800';
    if (multiplier < 0.9) return 'bg-green-100 text-green-800';
    return 'bg-gray-100 text-gray-800';
  };

  const trendPercentage = (trend.trend * 100).toFixed(1);
  const multiplierPercentage = (trend.multiplier * 100).toFixed(0);

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {getTrendIcon(trend.trend)}
          <div>
            <div className={`text-sm font-medium ${getTrendColor(trend.trend)}`}>
              {trend.trend > 0 ? 'Rising' : trend.trend < 0 ? 'Falling' : 'Stable'}
            </div>
            <div className="text-xs text-gray-500">
              {trend.trend > 0 ? '+' : ''}{trendPercentage}% trend
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-gray-500">Current Multiplier</div>
            <div className={`text-sm font-semibold px-2 py-1 rounded ${getMultiplierColor(trend.multiplier)}`}>
              {multiplierPercentage}%
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-gray-500">Samples</div>
            <div className="text-sm font-medium text-gray-900">{trend.trackedSamples}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Short-term avg: {trend.shortTermAverage.toFixed(2)}</span>
          <span>Long-term avg: {trend.longTermAverage.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
