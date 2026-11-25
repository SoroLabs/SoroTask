# AI-Powered Task Configuration Assistant Example Page

This example page demonstrates how to use the AI-Powered Task Configuration Assistant in your SoroTask application.

## Features Demonstrated

1. **Integrated Chat and Form** - AI chat on the left, auto-populated form on the right
2. **Real-time Configuration** - AI generates task configs that populate the form instantly
3. **Error Handling** - Graceful error messages and recovery
4. **Responsive Design** - Works on mobile and desktop

## Component: AITaskAssistant Page

```tsx
'use client';

import { AITaskAssistant } from '@/app/components/AITaskAssistant';

export default function CreateTaskWithAIPage() {
  return (
    <div className="min-h-screen bg-neutral-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-neutral-100 mb-2">
            Create Automation Task
          </h1>
          <p className="text-neutral-400">
            Use AI to help configure your recurring automation task. Describe what you want to automate, and let AI generate the configuration.
          </p>
        </div>

        {/* Main Content */}
        <AITaskAssistant 
          showTaskForm={true}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        />

        {/* Info Section */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 bg-neutral-900 border border-neutral-800 rounded-xl p-6">
          <div>
            <h3 className="text-lg font-semibold text-neutral-100 mb-2">
              ✨ AI-Powered
            </h3>
            <p className="text-sm text-neutral-400">
              Describe your task in natural language and let AI generate the configuration for you.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-neutral-100 mb-2">
              ⚡ Real-time Validation
            </h3>
            <p className="text-sm text-neutral-400">
              Configuration is validated in real-time with helpful suggestions.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-neutral-100 mb-2">
              🔒 Secure
            </h3>
            <p className="text-sm text-neutral-400">
              Your tasks are validated and stored securely on-chain.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

## Example Usage Scenarios

### Scenario 1: Yield Harvesting
**User Input:**
"I want to automatically harvest yield from my USDC position on the Stellar network every day at 2 AM with 50 XLM for gas."

**AI Response:**
- **Contract Address**: `CAA6NPUAA5SSJXFZB7XMZR7LNFWL7NQPL4CQIKCBGNP2IECQZ4JHVA`
- **Function Name**: `harvest_yield`
- **Interval**: `86400` (seconds = 1 day)
- **Gas Balance**: `50` XLM

### Scenario 2: Automated Trading
**User Input:**
"I want to automatically sell 10% of my holdings every week when price increases by 5%."

**AI Response:**
Generates:
- Configuration for automated selling
- ABI for the trading contract
- Condition code for price check
- Suggested gas balance

### Scenario 3: Liquidity Management
**User Input:**
"Rebalance my liquidity pool every 6 hours, add 100 USDC when reserves drop below 50%."

**AI Response:**
- **Function Name**: `rebalance_liquidity`
- **Interval**: `21600` (6 hours)
- **Conditions**: Price check, reserve level validation

## Try These Examples

Try these prompts in the AI chat to see it in action:

1. **Simple Harvesting**
   ```
   "Harvest yield every hour with 50 XLM gas"
   ```

2. **Complex Automation**
   ```
   "I want to execute a yield farming strategy that compounds every 6 hours, 
    requires 100 XLM minimum balance, and only executes if APY > 50%"
   ```

3. **Multi-step Process**
   ```
   "Create a task that: 
    1. Checks if my USDC balance > 1000
    2. If yes, swap 50% to native token
    3. Update my allocation
    Execute daily at midnight"
   ```

## Component Architecture

```
AITaskAssistant Page
│
├── AITaskAssistant Container
│   ├── AIChat Component
│   │   ├── Message Display
│   │   ├── Message Input
│   │   └── Configuration Display
│   │
│   └── TaskCreationForm
│       ├── Pre-populated with AI config
│       ├── Form Validation
│       └── Form Submission
│
└── Info Section
    └── Feature Highlights
```

## Key Integration Points

### 1. AI Chat Output
The AI generates configurations in this format:

```json
{
  "contractAddress": "CAA6NPUAA5SSJXFZB7XMZR7LNFWL7NQPL4CQIKCBGNP2IECQZ4JHVA",
  "functionName": "harvest_yield",
  "interval": 3600,
  "gasBalance": 50,
  "abiJson": "{...}",
  "conditions": "Optional condition description"
}
```

### 2. Form Auto-population
When config is generated, it automatically populates:
- Target Contract Address
- Function Name
- Interval (in seconds)
- Gas Balance (in XLM)

### 3. User Review & Submit
User can:
- Review generated configuration
- Edit fields if needed
- Validate before submission
- Submit to blockchain

## Testing the Integration

### Manual Test Flow

1. **Navigate to Page**
   ```
   http://localhost:3000/create-task-ai
   ```

2. **Describe Task**
   ```
   "I want to harvest yield every hour with 50 XLM"
   ```

3. **Verify Output**
   - Check AI response in chat
   - Verify form is populated
   - Review all fields are correct

4. **Edit if Needed**
   - Modify any field
   - Re-validate

5. **Submit**
   - Click "Register Task"
   - Confirm transaction

## Performance Metrics

Expected performance on typical hardware:

| Metric | Value |
|--------|-------|
| Page Load Time | < 2s |
| AI Response Time | 3-5s |
| Form Rendering | < 500ms |
| Validation Time | < 100ms |

## Accessibility

The component includes:
- ✅ ARIA labels on all inputs
- ✅ Keyboard navigation support
- ✅ Screen reader friendly
- ✅ High contrast mode support
- ✅ Semantic HTML structure

## Browser Support

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ⚠️ Mobile browsers (responsive design tested)

## Troubleshooting

### AI Chat Not Loading
1. Check `.env.local` has `NEXT_PUBLIC_OPENAI_API_KEY`
2. Verify API key is valid
3. Check browser console for errors

### Form Not Populating
1. Verify AI generates valid JSON
2. Check form validation rules
3. Look for console errors

### Response Too Slow
1. Check network connection
2. Try simpler prompt
3. Check OpenAI API status

## Security Considerations

- ✅ API key is browser-exposed in development only
- ⚠️ For production, use backend API proxy
- ✅ Inputs are validated before API calls
- ✅ Outputs are validated after API calls

See `AI_ASSISTANT_SETUP.md` for production security setup.

## Next Steps

1. **Integrate into Main Dashboard**
   - Add link from task list
   - Add quick-create button

2. **Add Analytics**
   - Track AI usage
   - Monitor error rates
   - Collect user feedback

3. **Enhance Features**
   - Multi-language support
   - Template suggestions
   - ABI file upload

4. **Optimize Performance**
   - Cache common configurations
   - Batch process multiple tasks
   - Implement request debouncing

## Resources

- [AI Assistant Documentation](AI_ASSISTANT_DOCUMENTATION.md)
- [AI Assistant Setup Guide](AI_ASSISTANT_SETUP.md)
- [Integration Guide](AI_ASSISTANT_INTEGRATION.md)
- [Frontend Setup](frontend/SETUP.md)
- [SoroTask Architecture](docs/task-state-machine.md)

---

**Created**: June 1, 2026
**Status**: MVP Ready for Testing
**Difficulty**: Advanced
**Estimated Effort**: 3-5 days
