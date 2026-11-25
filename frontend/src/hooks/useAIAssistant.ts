/**
 * Custom hook for AI chat interactions
 * Manages state and side effects for AI conversation
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getAIClient,
  OpenAIClient,
  AIMessage,
  AIResponse,
  TaskConfigGenerated,
  AIServiceError,
} from '@/src/lib/ai/openai-client';

export interface UseAIAssistantState {
  messages: AIMessage[];
  isLoading: boolean;
  error: string | null;
  taskConfig: TaskConfigGenerated | null;
  generatedABI: string | null;
}

export interface UseAIAssistantActions {
  sendMessage: (message: string) => Promise<void>;
  generateTaskConfig: (description: string) => Promise<void>;
  generateABI: (contractDescription: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
  resetState: () => void;
}

export function useAIAssistant(): UseAIAssistantState & UseAIAssistantActions {
  const clientRef = useRef<OpenAIClient | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskConfig, setTaskConfig] = useState<TaskConfigGenerated | null>(null);
  const [generatedABI, setGeneratedABI] = useState<string | null>(null);

  // Initialize client on mount
  useEffect(() => {
    try {
      clientRef.current = getAIClient();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearMessages = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.clearHistory();
    }
    setMessages([]);
  }, []);

  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!clientRef.current) {
        setError('AI client not initialized');
        return;
      }

      if (!userMessage.trim()) {
        setError('Message cannot be empty');
        return;
      }

      if (isLoading) return;

      setIsLoading(true);
      clearError();

      try {
        const response = await clientRef.current.chat(userMessage);
        const newMessages = clientRef.current.getHistory();
        setMessages(newMessages);
      } catch (err) {
        const errorMessage =
          err instanceof AIServiceError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Failed to send message';
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [clearError, isLoading]
  );

  const generateTaskConfig = useCallback(
    async (description: string) => {
      if (!clientRef.current) {
        setError('AI client not initialized');
        return;
      }

      if (!description.trim()) {
        setError('Description cannot be empty');
        return;
      }

      setIsLoading(true);
      clearError();

      try {
        const config = await clientRef.current.generateTaskConfig(description);
        setTaskConfig(config);

        // Add to message history for context
        const newMessages = clientRef.current.getHistory();
        setMessages(newMessages);
      } catch (err) {
        const errorMessage =
          err instanceof AIServiceError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Failed to generate task configuration';
        setError(errorMessage);
        setTaskConfig(null);
      } finally {
        setIsLoading(false);
      }
    },
    [clearError]
  );

  const generateABI = useCallback(
    async (contractDescription: string) => {
      if (!clientRef.current) {
        setError('AI client not initialized');
        return;
      }

      if (!contractDescription.trim()) {
        setError('Contract description cannot be empty');
        return;
      }

      setIsLoading(true);
      clearError();

      try {
        const abi = await clientRef.current.generateABI(contractDescription);
        setGeneratedABI(abi);

        // Add to message history for context
        const newMessages = clientRef.current.getHistory();
        setMessages(newMessages);
      } catch (err) {
        const errorMessage =
          err instanceof AIServiceError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Failed to generate ABI';
        setError(errorMessage);
        setGeneratedABI(null);
      } finally {
        setIsLoading(false);
      }
    },
    [clearError]
  );

  const resetState = useCallback(() => {
    clearMessages();
    clearError();
    setTaskConfig(null);
    setGeneratedABI(null);
  }, [clearMessages, clearError]);

  return {
    // State
    messages,
    isLoading,
    error,
    taskConfig,
    generatedABI,
    // Actions
    sendMessage,
    generateTaskConfig,
    generateABI,
    clearMessages,
    clearError,
    resetState,
  };
}
