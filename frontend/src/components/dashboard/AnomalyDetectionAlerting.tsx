import React, { useEffect, useState, useRef } from 'react';

interface Alert {
  id: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: string;
  value: number;
  threshold: number;
}

export const AnomalyDetectionAlerting: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize Web Worker for off-main-thread processing
    const workerCode = `
      self.onmessage = function(e) {
        const { type, data } = e.data;
        if (type === 'START_ANALYSIS') {
          setInterval(() => {
            // Simulate complex anomaly detection algorithms
            const value = Math.random() * 100;
            if (value > 90) {
              self.postMessage({
                type: 'ANOMALY_DETECTED',
                payload: {
                  id: Math.random().toString(36).substr(2, 9),
                  timestamp: Date.now(),
                  severity: value > 98 ? 'critical' : 'high',
                  metric: 'system_throughput',
                  value: value,
                  threshold: 90
                }
              });
            }
          }, 2000);
        }
      };
    `;
    
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    workerRef.current = new Worker(workerUrl);

    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'ANOMALY_DETECTED') {
        setAlerts(prev => [e.data.payload, ...prev].slice(0, 50)); // Keep last 50
      }
    };

    workerRef.current.postMessage({ type: 'START_ANALYSIS' });

    return () => {
      workerRef.current?.terminate();
      URL.revokeObjectURL(workerUrl);
    };
  }, []);

  const getSeverityColor = (severity: string) => {
    switch(severity) {
      case 'critical': return 'text-red-500 bg-red-500/10 border-red-500';
      case 'high': return 'text-orange-500 bg-orange-500/10 border-orange-500';
      default: return 'text-yellow-500 bg-yellow-500/10 border-yellow-500';
    }
  };

  return (
    <div className="anomaly-dashboard p-6 bg-gray-900 rounded-xl shadow-lg border border-gray-700 text-gray-100">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Anomaly Detection Alerts</h2>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm text-green-400">Worker Active</span>
        </div>
      </div>

      <div className="alerts-container h-[400px] overflow-y-auto space-y-3 pr-2">
        {alerts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-500 italic">
            Monitoring system metrics... No anomalies detected.
          </div>
        ) : (
          alerts.map(alert => (
            <div key={alert.id} className={`p-4 rounded-lg border flex items-center justify-between ${getSeverityColor(alert.severity)}`}>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold uppercase text-xs tracking-wider">{alert.severity}</span>
                  <span className="text-xs opacity-70">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="mt-1 font-mono text-sm">
                  Metric <span className="font-bold">{alert.metric}</span> spiked to {alert.value.toFixed(2)} (Threshold: {alert.threshold})
                </div>
              </div>
              <button className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors border border-gray-600">
                Acknowledge
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
