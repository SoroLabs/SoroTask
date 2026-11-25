'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useAIAssistant } from '@/src/hooks/useAIAssistant';
import type { AIMessage } from '@/src/lib/ai/openai-client';

export interface AIChatProps {
  onTaskConfigGenerated?: (config: any) => void;
  onABIGenerated?: (abi: string) => void;
  initialMessage?: string;
  className?: string;
}

interface ChatMessage extends AIMessage {
  id: string;
  timestamp: Date;
}

export function AIChat({
  onTaskConfigGenerated,
  onABIGenerated,
  initialMessage = 'Hi! I can help you create a task configuration. Describe what you want to automate, and I\'ll help you set it up.',
  className = '',
}: AIChatProps) {
  const {
    messages,
    isLoading,
    error,
    taskConfig,
    generatedABI,
    sendMessage,
    clearError,
  } = useAIAssistant();

  const [inputValue, setInputValue] = useState('');
  const [displayMessages, setDisplayMessages] = useState<ChatMessage[]>([
    {
      id: 'initial',
      role: 'assistant',
      content: initialMessage,
      timestamp: new Date(),
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync AI messages to display
  useEffect(() => {
    const newMessages = messages.map((msg, idx) => ({
      id: `msg-${Date.now()}-${idx}`,
      ...msg,
      timestamp: new Date(),
    }));
    if (newMessages.length > 0) {
      setDisplayMessages((prev) => [...prev, ...newMessages]);
    }
  }, [messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages]);

  // Handle task config generation callback
  useEffect(() => {
    if (taskConfig && onTaskConfigGenerated) {
      onTaskConfigGenerated(taskConfig);
    }
  }, [taskConfig, onTaskConfigGenerated]);

  // Handle ABI generation callback
  useEffect(() => {
    if (generatedABI && onABIGenerated) {
      onABIGenerated(generatedABI);
    }
  }, [generatedABI, onABIGenerated]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const message = inputValue.trim();
    setInputValue('');

    // Add user message to display immediately
    setDisplayMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      },
    ]);

    await sendMessage(message);
  };

  const handleGenerateTaskConfig = async () => {
    if (!inputValue.trim() || isLoading) return;

    const description = inputValue.trim();
    setInputValue('');

    setDisplayMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: `Generate task config: ${description}`,
        timestamp: new Date(),
      },
    ]);

    // We need to access the hook's generateTaskConfig directly
    // For now, let's use sendMessage as a workaround
    const prompt = `Generate task configuration from this description: ${description}`;
    await sendMessage(prompt);
  };

  return (
    <div className={`flex flex-col h-full bg-neutral-900 rounded-xl border border-neutral-700 ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-700 bg-neutral-800/50 flex-shrink-0">
        <h3 className="text-sm font-semibold text-neutral-200">AI Task Assistant</h3>
        <p className="text-xs text-neutral-400 mt-1">
          Describe your automation task in natural language
        </p>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {displayMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-800 text-neutral-100 border border-neutral-700'
              }`}
            >
              <p className="break-words">{msg.content}</p>
              <p className="text-xs mt-1 opacity-50">
                {msg.timestamp.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex justify-center">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 max-w-xs">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={clearError}
                className="text-xs text-red-300 hover:text-red-200 mt-1 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Task Config Generated */}
        {taskConfig && (
          <div className="flex justify-start">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2 max-w-xs">
              <p className="text-sm font-semibold text-green-400">Configuration Generated:</p>
              <div className="text-xs text-green-300 mt-2 space-y-1">
                {taskConfig.contractAddress && (
                  <p>
                    <span className="font-semibold">Address:</span> {taskConfig.contractAddress}
                  </p>
                )}
                {taskConfig.functionName && (
                  <p>
                    <span className="font-semibold">Function:</span> {taskConfig.functionName}
                  </p>
                )}
                {taskConfig.interval && (
                  <p>
                    <span className="font-semibold">Interval:</span> {taskConfig.interval}s
                  </p>
                )}
                {taskConfig.gasBalance && (
                  <p>
                    <span className="font-semibold">Gas:</span> {taskConfig.gasBalance} XLM
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Generated ABI */}
        {generatedABI && (
          <div className="flex justify-start">
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-4 py-2 max-w-xs">
              <p className="text-sm font-semibold text-purple-400">ABI Generated:</p>
              <pre className="text-xs text-purple-300 mt-2 overflow-auto bg-black/20 p-2 rounded max-h-32">
                {generatedABI.substring(0, 200)}...
              </pre>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-neutral-700 p-4 bg-neutral-800/30 flex-shrink-0">
        <form onSubmit={handleSendMessage} className="space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Describe your automation task..."
            disabled={isLoading}
            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {isLoading ? 'Generating...' : 'Send'}
            </button>
          </div>
        </form>

        {/* Help text */}
        <p className="text-xs text-neutral-500 mt-3">
          💡 Try: "I want to harvest yield from USDC every hour with 50 XLM gas"
        </p>
      </div>
    </div>
  );
}
