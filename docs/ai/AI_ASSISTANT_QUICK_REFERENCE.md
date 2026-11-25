# AI Assistant - Quick Reference Card

**Quick lookup guide for developers integrating the AI-Powered Task Configuration Assistant**

---

## Installation & Setup (2 minutes)

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Set Environment Variable
```bash
# Create/edit frontend/.env.local
NEXT_PUBLIC_OPENAI_API_KEY=sk_your_key_here
```

### 3. Done! 🎉

---

## Usage Examples

### Simplest: Full Integration
```tsx
import { AITaskAssistant } from '@/app/components/AITaskAssistant';

export default function Page() {
  return <AITaskAssistant showTaskForm={true} />;
}
```

### Chat Only
```tsx
import { AIChat } from '@/app/components/AIChat';

export default function Page() {
  return <AIChat className="h-96" />;
}
```

### With Callbacks
```tsx
<AIChat 
  onTaskConfigGenerated={(config) => console.log(config)}
  onABIGenerated={(abi) => console.log(abi)}
/>
```

### Using Hook
```tsx
const { messages, isLoading, error, taskConfig, sendMessage } = useAIAssistant();
```

---

## Component Props

### AITaskAssistant
```typescript
interface Props {
  className?: string;           // CSS classes
  showTaskForm?: boolean;       // Show form (default: true)
}
```

### AIChat
```typescript
interface Props {
  onTaskConfigGenerated?: (config: TaskConfigGenerated) => void;
  onABIGenerated?: (abi: string) => void;
  initialMessage?: string;
  className?: string;
}
```

### TaskCreationForm
```typescript
interface Props {
  initialConfig?: TaskConfigGenerated | null;
}
```

---

## Hook Methods

```typescript
const {
  // State
  messages: AIMessage[];
  isLoading: boolean;
  error: string | null;
  taskConfig: TaskConfigGenerated | null;
  generatedABI: string | null;
  
  // Actions
  sendMessage: (msg: string) => Promise<void>;
  generateTaskConfig: (desc: string) => Promise<void>;
  generateABI: (desc: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
  resetState: () => void;
} = useAIAssistant();
```

---

## API Reference

### Generated Task Config
```typescript
interface TaskConfigGenerated {
  contractAddress?: string;    // "CAA6NPUAA..."
  functionName?: string;       // "harvest_yield"
  interval?: number;           // seconds (min: 60)
  gasBalance?: number;         // XLM (0.1-10000)
  abiJson?: string;            // JSON string
  conditions?: string;         // Optional condition
}
```

### AI Message
```typescript
interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}
```

---

## Error Handling

### Error Codes
```
MISSING_API_KEY      - No API key configured
API_ERROR            - OpenAI API failure
EMPTY_RESPONSE       - No content from API
PARSE_ERROR          - Invalid response format
VALIDATION_ERROR     - Data validation failed
COMMUNICATION_ERROR  - Network error
GENERATION_ERROR     - Generation process failed
```

### Handle Errors
```tsx
const { error, clearError } = useAIAssistant();

if (error) {
  return (
    <div>
      <p>{error}</p>
      <button onClick={clearError}>Dismiss</button>
    </div>
  );
}
```

---

## Configuration

### Environment Variables
```env
# Required
NEXT_PUBLIC_OPENAI_API_KEY=sk_...

# Optional (with defaults)
NEXT_PUBLIC_OPENAI_MODEL=gpt-4-turbo-preview
NEXT_PUBLIC_OPENAI_TEMPERATURE=0.7
NEXT_PUBLIC_OPENAI_MAX_TOKENS=2000
NEXT_PUBLIC_AI_DEBUG=false
```

---

## Testing

### Run Tests
```bash
npm test                    # Run all tests
npm test AIChat.test.tsx    # Specific test
npm run test:coverage       # Coverage report
npm run test:watch         # Watch mode
```

### Test Files
- `__tests__/ai/openai-client.test.ts`
- `__tests__/ai/useAIAssistant.test.tsx`
- `__tests__/ai/AIChat.test.tsx`

---

## Styling

### Default Theme
- Dark mode only
- Tailwind CSS v4
- Responsive design
- Custom className support

### Custom Styles
```tsx
<AIChat className="custom-bg custom-border h-96" />
```

---

## Common Patterns

### Pattern 1: Modal Integration
```tsx
const [open, setOpen] = useState(false);

return (
  <>
    <button onClick={() => setOpen(true)}>Create with AI</button>
    {open && <AITaskAssistant />}
  </>
);
```

### Pattern 2: Side-by-Side
```tsx
<div className="grid grid-cols-2 gap-4">
  <AIChat />
  <TaskCreationForm />
</div>
```

### Pattern 3: Wizard Steps
```tsx
const [step, setStep] = useState('chat');

{step === 'chat' && <AIChat onTaskConfigGenerated={() => setStep('form')} />}
{step === 'form' && <TaskCreationForm />}
```

---

## Performance Tips

1. **Reduce Token Usage**
   - Use `gpt-3.5-turbo` for faster, cheaper responses
   - Set `NEXT_PUBLIC_OPENAI_MAX_TOKENS=1000`

2. **Optimize Temperature**
   - Lower temperature (0.3-0.5) = faster, more deterministic
   - Higher temperature (0.7-1.0) = creative, slower

3. **Cache Results**
   - Cache generated configs
   - Reuse successful prompts

4. **Monitor Usage**
   - Check OpenAI dashboard daily
   - Set spending alerts

---

## Troubleshooting

### "API key not configured"
```bash
# Check .env.local
cat frontend/.env.local | grep OPENAI

# Verify key starts with 'sk_'
```

### "Failed to generate config"
- Try simpler description
- Check API quota at openai.com
- Check network connection

### "Form not populating"
- Check browser console for errors
- Verify JSON format in response
- Check field validation rules

### "Slow responses"
- API may be under load
- Try simpler prompt
- Check network latency

---

## File Locations

```
Core Implementation:
├── src/lib/ai/openai-client.ts
├── src/hooks/useAIAssistant.ts
├── app/components/AIChat.tsx
├── app/components/AITaskAssistant.tsx

Tests:
├── __tests__/ai/openai-client.test.ts
├── __tests__/ai/useAIAssistant.test.tsx
└── __tests__/ai/AIChat.test.tsx

Documentation:
├── AI_ASSISTANT_DOCUMENTATION.md
├── AI_ASSISTANT_SETUP.md
├── AI_ASSISTANT_INTEGRATION.md
└── AI_ASSISTANT_EXAMPLE.md
```

---

## Resources

| Resource | Link/File |
|----------|-----------|
| Full Docs | AI_ASSISTANT_DOCUMENTATION.md |
| Setup Guide | AI_ASSISTANT_SETUP.md |
| Integration | AI_ASSISTANT_INTEGRATION.md |
| Examples | AI_ASSISTANT_EXAMPLE.md |
| OpenAI Docs | https://platform.openai.com/docs |

---

## Checklist for Adding to Your Page

- [ ] Import component: `import { AITaskAssistant } from '@/app/components/AITaskAssistant';`
- [ ] Add to JSX: `<AITaskAssistant showTaskForm={true} />`
- [ ] Test in browser
- [ ] Check console for errors
- [ ] Verify API key in `.env.local`
- [ ] Test message sending
- [ ] Test config generation
- [ ] Test form population
- [ ] Done! ✅

---

## Cost Estimate

**Average cost per interaction:**
- Simple config: ~$0.003-0.005
- Complex config: ~$0.01-0.02
- ABI generation: ~$0.01-0.03

**Monthly estimate (100 users × 10 requests):**
- 1000 requests × avg $0.01 = **~$10/month**

Use `gpt-3.5-turbo` to reduce to ~$2-3/month

---

## Security Reminder

⚠️ **Development**: API key in browser is OK (`.env.local` in `.gitignore`)
⚠️ **Production**: Move to backend API proxy!

See `AI_ASSISTANT_SETUP.md` for production setup.

---

## Need More Help?

1. Check documentation files listed above
2. Look at test files for usage examples
3. Check AI_ASSISTANT_EXAMPLE.md for page example
4. Review integration patterns in AI_ASSISTANT_INTEGRATION.md

---

**Last Updated**: June 1, 2026
**Version**: 1.0.0
**Status**: Production Ready
