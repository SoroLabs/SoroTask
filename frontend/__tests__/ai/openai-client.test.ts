/**
 * Tests for OpenAI Client
 */

import {
  OpenAIClient,
  AIServiceError,
  getAIClient,
  resetAIClient,
  type TaskConfigGenerated,
} from '@/src/lib/ai/openai-client';

// Mock OpenAI API
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    })),
  };
});

describe('OpenAIClient', () => {
  beforeEach(() => {
    resetAIClient();
    jest.clearAllMocks();
    // Set test API key
    process.env.NEXT_PUBLIC_OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with API key from environment', () => {
      expect(() => new OpenAIClient()).not.toThrow();
    });

    it('should throw if no API key provided', () => {
      delete process.env.NEXT_PUBLIC_OPENAI_API_KEY;
      expect(() => new OpenAIClient()).toThrow(AIServiceError);
    });

    it('should use provided API key over environment', () => {
      expect(() => new OpenAIClient('custom-key')).not.toThrow();
    });
  });

  describe('message history', () => {
    let client: OpenAIClient;

    beforeEach(() => {
      client = new OpenAIClient();
    });

    it('should add messages to history', () => {
      client.addMessage('user', 'Hello');
      client.addMessage('assistant', 'Hi there');

      const history = client.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(history[1]).toEqual({ role: 'assistant', content: 'Hi there' });
    });

    it('should clear history', () => {
      client.addMessage('user', 'Hello');
      client.clearHistory();

      expect(client.getHistory()).toHaveLength(0);
    });

    it('should maintain immutability of returned history', () => {
      client.addMessage('user', 'Test');
      const history1 = client.getHistory();
      const history2 = client.getHistory();

      expect(history1).not.toBe(history2);
    });
  });

  describe('parseTaskConfig', () => {
    let client: OpenAIClient;

    beforeEach(() => {
      client = new OpenAIClient();
    });

    it('should parse valid task configuration', () => {
      const json = JSON.stringify({
        contractAddress: 'CAA6NPUAA5SSJXFZB7XMZR7LNFWL7NQPL4CQIKCBGNP2IECQZ4JHVA',
        functionName: 'harvest_yield',
        interval: 3600,
        gasBalance: 50,
      });

      const config = client['parseTaskConfig'](json);
      expect(config).toEqual({
        contractAddress: 'CAA6NPUAA5SSJXFZB7XMZR7LNFWL7NQPL4CQIKCBGNP2IECQZ4JHVA',
        functionName: 'harvest_yield',
        interval: 3600,
        gasBalance: 50,
      });
    });

    it('should extract JSON from response with extra text', () => {
      const response = `Here's the configuration:
        {
          "contractAddress": "CAA6NPUAA5SSJXFZB7XMZR7LNFWL7NQPL4CQIKCBGNP2IECQZ4JHVA",
          "functionName": "harvest",
          "interval": 3600,
          "gasBalance": 50
        }
        Let me know if you need adjustments!`;

      const config = client['parseTaskConfig'](response);
      expect(config.functionName).toBe('harvest');
    });

    it('should enforce minimum interval', () => {
      const json = JSON.stringify({
        interval: 30, // Below minimum
      });

      const config = client['parseTaskConfig'](json);
      expect(config.interval).toBe(60);
    });

    it('should enforce gas balance bounds', () => {
      const json = JSON.stringify({
        gasBalance: 50000, // Above maximum
      });

      const config = client['parseTaskConfig'](json);
      expect(config.gasBalance).toBeLessThanOrEqual(10000);

      const json2 = JSON.stringify({
        gasBalance: 0.01, // Below minimum
      });

      const config2 = client['parseTaskConfig'](json2);
      expect(config2.gasBalance).toBeGreaterThanOrEqual(0.1);
    });

    it('should throw on invalid contract address', () => {
      const json = JSON.stringify({
        contractAddress: 'INVALID_ADDRESS',
      });

      expect(() => client['parseTaskConfig'](json)).toThrow(AIServiceError);
    });

    it('should throw on invalid JSON', () => {
      const invalidJson = 'not json at all';
      expect(() => client['parseTaskConfig'](invalidJson)).toThrow(
        AIServiceError
      );
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const client1 = getAIClient();
      const client2 = getAIClient();

      expect(client1).toBe(client2);
    });

    it('should reset instance', () => {
      const client1 = getAIClient();
      resetAIClient();
      const client2 = getAIClient();

      expect(client1).not.toBe(client2);
    });
  });
});
