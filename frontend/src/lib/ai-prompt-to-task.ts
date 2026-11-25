import { z } from 'zod';

const TaskConfigSchema = z.object({
  contractId: z.string().startsWith('C'),
  functionName: z.string(),
  args: z.array(z.any()),
  interval: z.object({
    type: z.enum(['cron', 'interval', 'once']),
    value: z.string(),
  }),
  conditions: z.array(z.object({
    type: z.enum(['gas_price', 'time', 'balance', 'price']),
    operator: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']),
    value: z.any(),
  })).optional(),
  maxGas: z.number().positive().optional(),
  memo: z.string().optional(),
});

type TaskConfig = z.infer<typeof TaskConfigSchema>;

interface ParsedPrompt {
  intent: string;
  contractAddress?: string;
  functionName?: string;
  interval?: { type: string; value: string };
  conditions?: Array<{ type: string; operator: string; value: any }>;
  args?: any[];
  confidence: number;
}

const EXAMPLE_PROMPTS = [
  {
    input: 'Harvest liquidity on Blend every 6 hours if rewards exceed 100 USDC',
    output: {
      intent: 'harvest_liquidity',
      contractAddress: 'CBLPF3UZKAKYI5FSDNFDXWQIQ3YFQ3VKD7STQMX46H4UB7KZQK5M5K3',
      functionName: 'harvest_rewards',
      interval: { type: 'interval', value: '6h' },
      conditions: [{ type: 'balance', operator: 'gt', value: '1000000000' }],
      args: [],
      confidence: 0.95,
    },
  },
  {
    input: 'Swap 50 USDC to XLM daily at 9am UTC',
    output: {
      intent: 'swap_tokens',
      contractAddress: 'CAFL67WSQGF4FNQKX7ZP6ZQXQXQXQXQXQXQXQXQXQXQXQXQXQXQX',
      functionName: 'swap',
      interval: { type: 'cron', value: '0 9 * * *' },
      conditions: [],
      args: ['USDC', 'XLM', '50000000'],
      confidence: 0.92,
    },
  },
  {
    input: 'Stake 100 XLM on Soroswap if APR is above 10%',
    output: {
      intent: 'stake_tokens',
      contractAddress: 'CB2NZJ5FKBZ6Z5ZQZ5ZQZ5ZQZ5ZQZ5ZQZ5ZQZ5ZQZ5ZQZ5ZQZ5Z',
      functionName: 'stake',
      interval: { type: 'once', value: 'immediate' },
      conditions: [{ type: 'price', operator: 'gt', value: 10 }],
      args: ['XLM', '10000000000'],
      confidence: 0.88,
    },
  },
];

export class AI PromptToTaskEngine {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async parsePrompt(userPrompt: string): Promise<ParsedPrompt> {
    const systemPrompt = `You are a Soroban smart contract task configuration parser. 
Convert natural language automation instructions into structured task configs.

Available contract types:
- Blend Protocol: liquidity harvesting, reward claiming
- Soroswap: token swaps, liquidity provision
- Stellar DEX: order book trades
- Custom contracts: any Soroban contract invocation

Output format:
{
  "intent": "string describing the task type",
  "contractId": "Stellar contract address (starts with C)",
  "functionName": "contract function to call",
  "interval": { "type": "cron|interval|once", "value": "..." },
  "conditions": [{ "type": "gas_price|time|balance|price", "operator": "gt|lt|eq|gte|lte", "value": "..." }],
  "args": [],
  "confidence": 0.0-1.0
}

Rules:
- Always use real Stellar contract addresses from known protocols
- Convert human time to cron or interval format
- Parse amounts with proper decimal handling
- Return confidence score based on prompt clarity`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from AI');
      }

      const parsed = JSON.parse(content);
      return this.validateAndEnhance(parsed, userPrompt);
    } catch (error) {
      console.error('AI parsing failed, falling back to pattern matching', error);
      return this.fallbackPatternMatch(userPrompt);
    }
  }

  private validateAndEnhance(parsed: any, originalPrompt: string): ParsedPrompt {
    const result: ParsedPrompt = {
      intent: parsed.intent || 'unknown',
      confidence: parsed.confidence || 0.5,
    };

    if (parsed.contractId && parsed.contractId.startsWith('C')) {
      result.contractAddress = parsed.contractId;
    }

    if (parsed.functionName) {
      result.functionName = parsed.functionName;
    }

    if (parsed.interval) {
      result.interval = this.normalizeInterval(parsed.interval);
    }

    if (parsed.conditions) {
      result.conditions = parsed.conditions.map((c: any) => ({
        type: c.type,
        operator: c.operator,
        value: c.value,
      }));
    }

    if (parsed.args) {
      result.args = parsed.args;
    }

    return result;
  }

  private normalizeInterval(interval: any): { type: string; value: string } {
    const type = interval.type || 'once';
    let value = interval.value;

    if (type === 'interval') {
      const match = value.match(/^(\d+)(m|h|d)$/);
      if (match) {
        const num = parseInt(match[1]);
        const unit = match[2];
        const minutes = unit === 'm' ? num : unit === 'h' ? num * 60 : num * 1440;
        value = `${minutes}m`;
      }
    }

    return { type, value };
  }

  private fallbackPatternMatch(prompt: string): ParsedPrompt {
    const lowerPrompt = prompt.toLowerCase();

    let intent = 'unknown';
    let functionName = 'execute';

    if (lowerPrompt.includes('harvest') || lowerPrompt.includes('claim')) {
      intent = 'harvest';
      functionName = 'harvest_rewards';
    } else if (lowerPrompt.includes('swap')) {
      intent = 'swap';
      functionName = 'swap';
    } else if (lowerPrompt.includes('stake')) {
      intent = 'stake';
      functionName = 'stake';
    } else if (lowerPrompt.includes('send') || lowerPrompt.includes('transfer')) {
      intent = 'transfer';
      functionName = 'transfer';
    }

    const intervalMatch = prompt.match(/every\s+(\d+)\s*(minute|hour|day|week)/i);
    let interval = { type: 'once', value: 'immediate' };
    if (intervalMatch) {
      const num = parseInt(intervalMatch[1]);
      const unit = intervalMatch[2].toLowerCase();
      if (unit.includes('minute')) interval = { type: 'interval', value: `${num}m` };
      else if (unit.includes('hour')) interval = { type: 'interval', value: `${num}h` };
      else if (unit.includes('day')) interval = { type: 'interval', value: `${num}d` };
    }

    return {
      intent,
      interval,
      args: [],
      confidence: 0.6,
    };
  }

  async validateConfig(config: ParsedPrompt): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!config.contractAddress) {
      errors.push('Contract address is required');
    } else if (!config.contractAddress.startsWith('C')) {
      errors.push('Invalid Stellar contract address format');
    }

    if (!config.functionName) {
      errors.push('Function name is required');
    }

    if (config.interval?.type === 'cron' && !this.isValidCron(config.interval.value)) {
      errors.push('Invalid cron expression');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private isValidCron(expression: string): boolean {
    const parts = expression.split(' ');
    return parts.length === 5;
  }

  getExamplePrompts(): typeof EXAMPLE_PROMPTS {
    return EXAMPLE_PROMPTS;
  }
}

export function createPromptToTaskEngine(apiKey?: string): AI PromptToTaskEngine {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key is required');
  }
  return new AIPromptToTaskEngine(key);
}
