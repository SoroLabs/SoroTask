/**
 * OpenAI Client Wrapper
 * Handles all communication with OpenAI API with error handling and fallbacks
 */

import OpenAI from 'openai';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface TaskConfigGenerated {
  contractAddress?: string;
  functionName?: string;
  interval?: number;
  gasBalance?: number;
  abiJson?: string;
  conditions?: string;
}

export class AIServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

export class OpenAIClient {
  private client: OpenAI;
  private conversationHistory: AIMessage[] = [];

  constructor(apiKey?: string) {
    const key = apiKey || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!key) {
      throw new AIServiceError(
        'OpenAI API key not configured',
        'MISSING_API_KEY'
      );
    }
    this.client = new OpenAI({
      apiKey: key,
      dangerouslyAllowBrowser: true, // Required for client-side usage
    });
  }

  /**
   * Add a message to conversation history
   */
  addMessage(role: 'user' | 'assistant', content: string): void {
    this.conversationHistory.push({ role, content });
  }

  /**
   * Get current conversation history
   */
  getHistory(): AIMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Send a message and get a response
   */
  async chat(userMessage: string): Promise<AIResponse> {
    try {
      this.addMessage('user', userMessage);

      const response = await this.client.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: this.conversationHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: 0.7,
        max_tokens: 2000,
      });

      if (!response.choices[0].message.content) {
        throw new AIServiceError(
          'Empty response from OpenAI',
          'EMPTY_RESPONSE'
        );
      }

      const assistantMessage = response.choices[0].message.content;
      this.addMessage('assistant', assistantMessage);

      return {
        content: assistantMessage,
        stop_reason: response.choices[0].finish_reason,
        usage: response.usage
          ? {
              input_tokens: response.usage.prompt_tokens,
              output_tokens: response.usage.completion_tokens,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new AIServiceError(
          `OpenAI API error: ${error.message}`,
          'API_ERROR',
          error
        );
      }
      if (error instanceof AIServiceError) {
        throw error;
      }
      throw new AIServiceError(
        `Failed to communicate with AI service: ${error instanceof Error ? error.message : String(error)}`,
        'COMMUNICATION_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Generate task configuration from natural language description
   */
  async generateTaskConfig(description: string): Promise<TaskConfigGenerated> {
    try {
      const prompt = this.buildTaskConfigPrompt(description);
      const response = await this.chat(prompt);

      return this.parseTaskConfig(response.content);
    } catch (error) {
      if (error instanceof AIServiceError) {
        throw error;
      }
      throw new AIServiceError(
        `Failed to generate task configuration: ${error instanceof Error ? error.message : String(error)}`,
        'GENERATION_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Parse ABI from natural language description
   */
  async generateABI(contractDescription: string): Promise<string> {
    try {
      const prompt = this.buildABIPrompt(contractDescription);
      const response = await this.chat(prompt);
      return response.content;
    } catch (error) {
      if (error instanceof AIServiceError) {
        throw error;
      }
      throw new AIServiceError(
        `Failed to generate ABI: ${error instanceof Error ? error.message : String(error)}`,
        'ABI_GENERATION_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Build prompt for task configuration generation
   */
  private buildTaskConfigPrompt(description: string): string {
    return `You are a Soroban smart contract expert helping users create task configurations.

Based on the following description, extract or suggest the task configuration parameters.
Return the response as JSON in this exact format (only include fields you can determine):
{
  "contractAddress": "C... (Stellar contract address or null)",
  "functionName": "function_name_in_snake_case",
  "interval": number (in seconds, minimum 60),
  "gasBalance": number (in XLM, recommended 10-100),
  "abiJson": "optional ABI JSON string",
  "conditions": "optional condition description"
}

User description:
${description}

Respond ONLY with valid JSON, no additional text.`;
  }

  /**
   * Build prompt for ABI generation
   */
  private buildABIPrompt(contractDescription: string): string {
    return `You are a Soroban/Stellar smart contract expert.

Generate a JSON ABI (Application Binary Interface) based on this contract description:
${contractDescription}

Return a valid JSON ABI with:
- functions array with name, inputs (array), outputs
- Each input/output should have name, type, doc

Respond ONLY with valid JSON ABI, no additional text.`;
  }

  /**
   * Parse task configuration from AI response
   */
  private parseTaskConfig(response: string): TaskConfigGenerated {
    try {
      // Extract JSON from response (handle cases where AI adds extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new AIServiceError(
          'Could not find JSON in response',
          'PARSE_ERROR'
        );
      }

      const config = JSON.parse(jsonMatch[0]) as TaskConfigGenerated;

      // Validate basic structure
      if (config.contractAddress && !config.contractAddress.startsWith('C')) {
        throw new AIServiceError(
          'Invalid contract address format (must start with C)',
          'VALIDATION_ERROR'
        );
      }

      if (config.interval && config.interval < 60) {
        config.interval = 60; // Minimum interval
      }

      if (config.gasBalance && (config.gasBalance < 0.1 || config.gasBalance > 10000)) {
        config.gasBalance = Math.max(0.1, Math.min(10000, config.gasBalance));
      }

      return config;
    } catch (error) {
      if (error instanceof AIServiceError) {
        throw error;
      }
      throw new AIServiceError(
        `Failed to parse task configuration: ${error instanceof Error ? error.message : String(error)}`,
        'PARSE_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }
}

/**
 * Singleton instance for use across the app
 */
let clientInstance: OpenAIClient | null = null;

export function getAIClient(apiKey?: string): OpenAIClient {
  if (!clientInstance) {
    clientInstance = new OpenAIClient(apiKey);
  }
  return clientInstance;
}

export function resetAIClient(): void {
  clientInstance = null;
}
