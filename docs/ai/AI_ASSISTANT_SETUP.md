# AI Assistant Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
cd frontend
npm install
```

This will install:
- `openai`: OpenAI SDK for API communication
- `zod`: Runtime type validation (optional, for advanced validation)

### 2. Configure Environment

Create a `.env.local` file in the `frontend/` directory:

```env
# OpenAI API Configuration
NEXT_PUBLIC_OPENAI_API_KEY=sk_your_actual_api_key_here
```

### 3. Set Up OpenAI API Key

1. Go to [OpenAI API Keys](https://platform.openai.com/api/keys)
2. Create a new API key
3. Add it to `.env.local`

**⚠️ Security Warning**: Never commit `.env.local` to version control. Use `.env.local.example` for team setup.

```bash
# Create example file for team
cp frontend/.env.local frontend/.env.local.example
# Remove actual key
# Edit .env.local.example and replace with placeholder
git add frontend/.env.local.example
```

### 4. Verify Setup

```bash
# Test development server starts
npm run dev

# Open http://localhost:3000
# Navigate to task creation page
# Try the AI assistant
```

## Configuration Options

### Basic Configuration (Required)

```env
# Your OpenAI API key
NEXT_PUBLIC_OPENAI_API_KEY=sk_your_key_here
```

### Advanced Configuration (Optional)

```env
# Model selection (default: gpt-4-turbo-preview)
# Options: gpt-4-turbo-preview, gpt-4, gpt-3.5-turbo
NEXT_PUBLIC_OPENAI_MODEL=gpt-4-turbo-preview

# Response creativity (default: 0.7, range: 0-2)
# Lower = more deterministic, Higher = more creative
NEXT_PUBLIC_OPENAI_TEMPERATURE=0.7

# Maximum tokens per response (default: 2000)
NEXT_PUBLIC_OPENAI_MAX_TOKENS=2000

# Enable debug logging (optional)
NEXT_PUBLIC_AI_DEBUG=false
```

## Testing

### Run Unit Tests

```bash
# All tests
npm test

# Specific test file
npm test AIChat.test.tsx

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Files Location

- `__tests__/ai/openai-client.test.ts` - OpenAI client tests
- `__tests__/ai/useAIAssistant.test.tsx` - Hook tests
- `__tests__/ai/AIChat.test.tsx` - Component tests

### Manual Testing Checklist

- [ ] AI chat loads without errors
- [ ] Can send message and receive response
- [ ] Task config generation works
- [ ] Generated config populates form
- [ ] Form validation works with AI data
- [ ] Error messages display correctly
- [ ] Can dismiss errors and retry
- [ ] Loading states show appropriately
- [ ] Mobile responsive layout works

## Development Workflow

### Adding New AI Features

1. **Update OpenAIClient** if adding new AI capabilities
2. **Update useAIAssistant** hook to expose new functionality
3. **Create/Update Components** that use the new features
4. **Add Tests** for new code (aim for >90% coverage)
5. **Update Documentation** in `AI_ASSISTANT_DOCUMENTATION.md`

### Example: Adding a New Generation Method

```typescript
// 1. Add to OpenAIClient
async generateCondition(description: string): Promise<string> {
  const prompt = this.buildConditionPrompt(description);
  const response = await this.chat(prompt);
  return this.parseCondition(response.content);
}

// 2. Add to useAIAssistant
const generateCondition = useCallback(
  async (description: string) => {
    // Implementation
  },
  []
);

// 3. Export in hook return
return {
  // ... existing state
  generateCondition,
};

// 4. Use in component
const { generateCondition } = useAIAssistant();
```

## Production Deployment

### API Key Security

For production, **DO NOT** expose OpenAI API keys in the browser. Instead:

1. **Create Backend Proxy**

```typescript
// pages/api/ai/chat.ts (Next.js API route)
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Server-side only
});

export default async function handler(req, res) {
  const { messages } = req.body;

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages,
    temperature: 0.7,
    max_tokens: 2000,
  });

  return res.json(response.choices[0].message);
}
```

2. **Update Client Code**

```typescript
// src/lib/ai/openai-client.ts (for backend proxy)
async chat(userMessage: string): Promise<AIResponse> {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: this.conversationHistory,
    }),
  });
  
  return response.json();
}
```

3. **Configure Environment**

```env
# .env (server-side only)
OPENAI_API_KEY=sk_your_key_here

# .env.local (client-side, if using proxy)
NEXT_PUBLIC_API_URL=https://your-api.com
```

### Deployment Checklist

- [ ] Move OpenAI key to backend environment
- [ ] Create API proxy endpoints
- [ ] Update client to use backend API
- [ ] Add rate limiting to backend
- [ ] Set up error logging (Sentry, LogRocket, etc.)
- [ ] Monitor token usage and costs
- [ ] Test thoroughly in staging
- [ ] Update documentation with production setup

## Troubleshooting

### API Key Issues

**Error: "OpenAI API key not configured"**

```bash
# Check .env.local exists
ls -la frontend/.env.local

# Verify key is set
grep NEXT_PUBLIC_OPENAI_API_KEY frontend/.env.local

# Test key is valid
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Response Issues

**Error: "Failed to generate task configuration"**

- Check OpenAI API status: https://status.openai.com/
- Verify API key has access to GPT-4
- Check request format matches OpenAI schema
- Look at browser DevTools Network tab for actual error

### Performance Issues

**Slow responses**

```env
# Try faster model
NEXT_PUBLIC_OPENAI_MODEL=gpt-3.5-turbo

# Reduce max tokens
NEXT_PUBLIC_OPENAI_MAX_TOKENS=1000

# Reduce temperature for faster responses
NEXT_PUBLIC_OPENAI_TEMPERATURE=0.5
```

## Cost Management

### Monitor Usage

OpenAI API pricing varies by model:
- **GPT-4 Turbo**: ~$0.01/1K input tokens, ~$0.03/1K output tokens
- **GPT-4**: More expensive
- **GPT-3.5 Turbo**: Cheaper (~$0.0005/1K input, $0.0015/1K output)

### Estimate Costs

Average task config generation:
- Input tokens: ~200
- Output tokens: ~150
- Total: ~350 tokens ≈ $0.003-$0.01 per request

For 100 users per month with 10 requests each:
- 1000 requests × $0.005 average = ~$5-20/month

### Cost Control Strategies

1. Use GPT-3.5-turbo for most tasks
2. Implement caching for repeated requests
3. Set reasonable `max_tokens` limits
4. Monitor usage in OpenAI dashboard
5. Consider batch processing for lower rates

## Support

For issues or questions:

1. Check [OpenAI Documentation](https://platform.openai.com/docs)
2. Review [SoroTask Issues](https://github.com/your-org/sorotask/issues)
3. Check this guide's troubleshooting section
4. Check main documentation: `AI_ASSISTANT_DOCUMENTATION.md`

## Resources

- **OpenAI API Docs**: https://platform.openai.com/docs/api-reference
- **OpenAI Playground**: https://platform.openai.com/playground
- **SoroTask Docs**: `/docs`
- **Frontend Setup**: `frontend/SETUP.md`
