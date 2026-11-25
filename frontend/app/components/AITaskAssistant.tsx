'use client';

import React, { useState } from 'react';
import { AIChat } from './AIChat';
import TaskCreationForm from './TaskCreationForm';
import type { TaskConfigGenerated } from '@/src/lib/ai/openai-client';

interface AITaskAssistantProps {
  className?: string;
  showTaskForm?: boolean;
}

export function AITaskAssistant({
  className = '',
  showTaskForm = true,
}: AITaskAssistantProps) {
  const [generatedConfig, setGeneratedConfig] =
    useState<TaskConfigGenerated | null>(null);
  const [generatedABI, setGeneratedABI] = useState<string | null>(null);

  const handleTaskConfigGenerated = (config: TaskConfigGenerated) => {
    setGeneratedConfig(config);
  };

  const handleABIGenerated = (abi: string) => {
    setGeneratedABI(abi);
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* AI Chat Interface */}
      <div className="lg:col-span-1">
        <AIChat
          onTaskConfigGenerated={handleTaskConfigGenerated}
          onABIGenerated={handleABIGenerated}
          className="h-96"
        />
      </div>

      {/* Task Creation Form with AI-Generated Data */}
      {showTaskForm && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-neutral-100">Task Configuration</h2>
            {generatedConfig && (
              <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">
                AI Generated
              </span>
            )}
          </div>

          <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-6">
            <TaskCreationForm initialConfig={generatedConfig} />
          </div>

          {/* Generated ABI Display */}
          {generatedABI && (
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-neutral-100 mb-4">Generated ABI</h3>
              <pre className="bg-black/40 border border-neutral-700 rounded-lg p-4 overflow-auto max-h-64 text-xs text-neutral-300 font-mono">
                {JSON.stringify(JSON.parse(generatedABI), null, 2)}
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedABI);
                }}
                className="mt-4 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                📋 Copy ABI
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
