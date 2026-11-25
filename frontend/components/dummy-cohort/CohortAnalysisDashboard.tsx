"use client";
import React, { useState, useEffect } from 'react';
import * as Sentry from '@/src/lib/errors/sentry';

interface CohortData {
  id: string;
  name: string;
  retention: number;
}

export function CohortAnalysisDashboard() {
  const [data, setData] = useState<CohortData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Simulate fault-tolerant data pipeline
        const res = await fetch('/api/cohort-data');
        if (!res.ok) throw new Error('Data pipeline failure');
        const json = await res.json();
        setData(json);
        Sentry.addSentryBreadcrumb("cohort", "Cohort data loaded successfully", { count: json.length });
      } catch (err: any) {
        setError('Fallback system activated: Unable to load cohort data securely.');
        Sentry.captureSentryException(err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, []);

  if (loading) return <div data-testid="cohort-loading">Loading secure cohort data...</div>;
  if (error) return <div data-testid="cohort-error" className="text-rose-500">{error}</div>;

  return (
    <div className="p-4 border border-slate-700 rounded-2xl bg-slate-900/60" data-testid="cohort-dashboard">
      <h2 className="text-xl font-bold mb-4 text-slate-100">Secure User Cohort Analysis</h2>
      <ul className="space-y-2 text-slate-300">
        {data.map((cohort) => (
          <li key={cohort.id} data-testid={`cohort-item-${cohort.id}`}>
            {cohort.name} - {cohort.retention}% Retention
          </li>
        ))}
      </ul>
    </div>
  );
}
