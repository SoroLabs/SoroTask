/**
 * Tests for useAIAssistant hook
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useAIAssistant } from '@/src/hooks/useAIAssistant';
import * as aiClient from '@/src/lib/ai/openai-client';

// Mock the AI client
jest.mock('@/src/lib/ai/openai-client', () => ({
  getAIClient: jest.fn(),
  resetAIClient: jest.fn(),
  AIServiceError: class AIServiceError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'AIServiceError';
    }
  },
}));

describe('useAIAssistant', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      clearHistory: jest.fn(),
      getHistory: jest.fn(() => []),
      chat: jest.fn(),
      generateTaskConfig: jest.fn(),
      generateABI: jest.fn(),
    };

    (aiClient.getAIClient as jest.Mock).mockReturnValue(mockClient);
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with empty messages and no error', () => {
      const { result } = renderHook(() => useAIAssistant());

      expect(result.current.messages).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.taskConfig).toBeNull();
      expect(result.current.generatedABI).toBeNull();
    });

    it('should handle initialization error', () => {
      (aiClient.getAIClient as jest.Mock).mockImplementation(() => {
        throw new Error('API key not configured');
      });

      const { result } = renderHook(() => useAIAssistant());

      expect(result.current.error).toBe('API key not configured');
    });
  });

  describe('sendMessage', () => {
    it('should send message and update state', async () => {
      const mockResponse = {
        content: 'Response from AI',
        stop_reason: 'end_turn',
      };

      mockClient.chat.mockResolvedValue(mockResponse);
      mockClient.getHistory.mockReturnValue([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Response from AI' },
      ]);

      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(mockClient.chat).toHaveBeenCalledWith('Hello');
      expect(result.current.messages).toHaveLength(2);
    });

    it('should reject empty messages', async () => {
      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.sendMessage('   ');
      });

      expect(result.current.error).toBe('Message cannot be empty');
      expect(mockClient.chat).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      const mockError = new aiClient.AIServiceError('API Error', 'API_ERROR');
      mockClient.chat.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      expect(result.current.error).toContain('API_ERROR');
      expect(result.current.isLoading).toBe(false);
    });

    it('should prevent sending while loading', async () => {
      mockClient.chat.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ content: 'Response' }), 100)
          )
      );

      const { result } = renderHook(() => useAIAssistant());

      let promise: Promise<void>;
      act(() => {
        promise = result.current.sendMessage('Test');
      });
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        await promise;
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('generateTaskConfig', () => {
    it('should generate task configuration', async () => {
      const mockConfig = {
        contractAddress: 'CAA6NPUAA5SSJXFZB7XMZR7LNFWL7NQPL4CQIKCBGNP2IECQZ4JHVA',
        functionName: 'harvest',
        interval: 3600,
        gasBalance: 50,
      };

      mockClient.generateTaskConfig.mockResolvedValue(mockConfig);
      mockClient.getHistory.mockReturnValue([
        { role: 'user', content: 'Generate task config' },
      ]);

      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.generateTaskConfig('Harvest yield hourly');
      });

      expect(mockClient.generateTaskConfig).toHaveBeenCalledWith(
        'Harvest yield hourly'
      );
      expect(result.current.taskConfig).toEqual(mockConfig);
    });

    it('should reject empty descriptions', async () => {
      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.generateTaskConfig('   ');
      });

      expect(result.current.error).toBe('Description cannot be empty');
      expect(mockClient.generateTaskConfig).not.toHaveBeenCalled();
    });

    it('should handle generation errors', async () => {
      const mockError = new aiClient.AIServiceError(
        'Generation failed',
        'GENERATION_ERROR'
      );
      mockClient.generateTaskConfig.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.generateTaskConfig('Test');
      });

      expect(result.current.error).toContain('GENERATION_ERROR');
      expect(result.current.taskConfig).toBeNull();
    });
  });

  describe('generateABI', () => {
    it('should generate ABI', async () => {
      const mockABI = JSON.stringify({
        functions: [{ name: 'harvest', inputs: [], outputs: [] }],
      });

      mockClient.generateABI.mockResolvedValue(mockABI);
      mockClient.getHistory.mockReturnValue([
        { role: 'user', content: 'Generate ABI' },
      ]);

      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.generateABI('Contract that harvests yield');
      });

      expect(mockClient.generateABI).toHaveBeenCalledWith(
        'Contract that harvests yield'
      );
      expect(result.current.generatedABI).toBe(mockABI);
    });

    it('should reject empty descriptions', async () => {
      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.generateABI('   ');
      });

      expect(result.current.error).toBe('Contract description cannot be empty');
      expect(mockClient.generateABI).not.toHaveBeenCalled();
    });
  });

  describe('utility functions', () => {
    it('should clear messages', async () => {
      mockClient.getHistory.mockReturnValue([
        { role: 'user', content: 'Test' },
      ]);

      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.sendMessage('Test');
      });

      expect(result.current.messages).toHaveLength(1);

      act(() => {
        result.current.clearMessages();
      });

      expect(mockClient.clearHistory).toHaveBeenCalled();
      expect(result.current.messages).toHaveLength(0);
    });

    it('should clear error', () => {
      const { result } = renderHook(() => useAIAssistant());

      act(() => {
        result.current.sendMessage(''); // Trigger error
      });

      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('should reset all state', async () => {
      mockClient.generateTaskConfig.mockResolvedValue({
        functionName: 'test',
      });
      mockClient.getHistory.mockReturnValue([]);

      const { result } = renderHook(() => useAIAssistant());

      await act(async () => {
        await result.current.generateTaskConfig('Test');
      });

      expect(result.current.taskConfig).not.toBeNull();

      act(() => {
        result.current.resetState();
      });

      expect(result.current.messages).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.taskConfig).toBeNull();
      expect(result.current.generatedABI).toBeNull();
      expect(mockClient.clearHistory).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should maintain previous state on error', async () => {
      const initialConfig = { functionName: 'initial' };

      const { result } = renderHook(() => useAIAssistant());

      // Mock initial state
      act(() => {
        result.current.taskConfig = initialConfig as any;
      });

      mockClient.generateTaskConfig.mockRejectedValue(
        new aiClient.AIServiceError('Error', 'ERROR')
      );

      await act(async () => {
        await result.current.generateTaskConfig('Test');
      });

      // State should be cleared on error
      expect(result.current.taskConfig).toBeNull();
      expect(result.current.error).not.toBeNull();
    });
  });
});
