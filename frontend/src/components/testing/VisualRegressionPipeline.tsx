import React, { useState } from 'react';

interface DiffResult {
  file: string;
  diffPercentage: number;
  status: 'passed' | 'failed' | 'processing';
  mismatchPixels?: number;
}

export const VisualRegressionPipeline: React.FC = () => {
  const [results, setResults] = useState<DiffResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const triggerPipeline = async () => {
    setIsRunning(true);
    setResults([]);
    
    // Simulating complex fault-tolerant data pipeline for VR
    try {
      const simulatedData: DiffResult[] = [
        { file: 'Dashboard.png', diffPercentage: 0.01, status: 'passed', mismatchPixels: 12 },
        { file: 'ProfileSettings.png', diffPercentage: 2.4, status: 'failed', mismatchPixels: 5300 },
        { file: 'DataGrid.png', diffPercentage: 0, status: 'passed', mismatchPixels: 0 }
      ];
      
      for(const item of simulatedData) {
        await new Promise(resolve => setTimeout(resolve, 800));
        setResults(prev => [...prev, item]);
      }
    } catch (err) {
      console.error("Pipeline failure: ", err);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="visual-regression p-6 bg-slate-800 text-white rounded-xl shadow-lg border border-slate-600">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Visual Regression Pipeline</h2>
        <button 
          onClick={triggerPipeline} 
          disabled={isRunning}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium disabled:opacity-50"
        >
          {isRunning ? 'Running Analysis...' : 'Start Pipeline'}
        </button>
      </div>

      <div className="results-grid grid gap-4">
        {results.length === 0 && !isRunning ? (
          <p className="text-gray-400 italic">No regression data available. Start the pipeline.</p>
        ) : (
          results.map((result, idx) => (
            <div key={idx} className={`p-4 rounded border ${result.status === 'failed' ? 'border-red-500 bg-red-900/30' : 'border-green-500 bg-green-900/30'}`}>
              <div className="flex justify-between">
                <span className="font-mono text-sm">{result.file}</span>
                <span className={`uppercase text-xs font-bold px-2 py-1 rounded ${result.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                  {result.status}
                </span>
              </div>
              <div className="mt-2 text-sm text-gray-300">
                Diff: {result.diffPercentage}% ({result.mismatchPixels} mismatched pixels)
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
