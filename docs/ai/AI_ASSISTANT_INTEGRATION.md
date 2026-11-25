# AI Assistant Integration Guide

## Quick Integration Examples

### Option 1: Full AI Assistant (Chat + Form)

Perfect for the main task creation page.

```tsx
// app/create-task/page.tsx
import { AITaskAssistant } from '@/app/components/AITaskAssistant';

export default function CreateTaskPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Create New Task</h1>
      <AITaskAssistant 
        showTaskForm={true}
        className="max-w-4xl"
      />
    </div>
  );
}
```

### Option 2: AI Chat Only

For dashboards or sidebars where you want just the chat.

```tsx
// app/dashboard/page.tsx
import { AIChat } from '@/app/components/AIChat';

export default function Dashboard() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2">
        {/* Main content */}
      </div>
      <div className="col-span-1">
        <AIChat 
          className="h-full"
          initialMessage="Need help configuring a task?"
        />
      </div>
    </div>
  );
}
```

### Option 3: Programmatic Control

For advanced scenarios where you need full control.

```tsx
// components/CustomAIIntegration.tsx
'use client';

import { useAIAssistant } from '@/src/hooks/useAIAssistant';
import { useEffect } from 'react';

export function CustomAIIntegration() {
  const {
    messages,
    isLoading,
    error,
    taskConfig,
    sendMessage,
    generateTaskConfig,
    clearError,
  } = useAIAssistant();

  // Example: Auto-generate config on mount
  useEffect(() => {
    generateTaskConfig('Harvest USDC yield every hour with 50 XLM');
  }, []);

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {isLoading && <div className="loading">Generating...</div>}
      {taskConfig && (
        <div className="config">
          Function: {taskConfig.functionName}
          Interval: {taskConfig.interval}s
          Gas: {taskConfig.gasBalance} XLM
        </div>
      )}
    </div>
  );
}
```

## Integration Patterns

### Pattern 1: Modal-Based Integration

```tsx
import { AITaskAssistant } from '@/app/components/AITaskAssistant';
import { Dialog } from '@/components/ui/dialog';
import { useState } from 'react';

export function TaskCreationModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>
        Create Task with AI
      </button>
      
      <Dialog open={open} onOpenChange={setOpen}>
        <div className="w-full max-w-2xl">
          <AITaskAssistant showTaskForm={true} />
        </div>
      </Dialog>
    </>
  );
}
```

### Pattern 2: Split-Screen Layout

```tsx
export function SplitScreenTaskCreation() {
  return (
    <div className="grid grid-cols-2 gap-8 h-screen">
      {/* Left: AI Chat */}
      <div className="overflow-hidden">
        <AIChat 
          className="h-full"
          onTaskConfigGenerated={(config) => {
            // Handle config in right panel
          }}
        />
      </div>
      
      {/* Right: Task Form */}
      <div className="overflow-auto">
        <TaskCreationForm />
      </div>
    </div>
  );
}
```

### Pattern 3: Wizard Steps

```tsx
import { useState } from 'react';
import { AIChat } from '@/app/components/AIChat';
import TaskCreationForm from '@/app/components/TaskCreationForm';

export function TaskWizard() {
  const [step, setStep] = useState<'chat' | 'form' | 'review'>('chat');
  const [config, setConfig] = useState(null);

  return (
    <div className="space-y-6">
      {/* Step 1: AI Chat for Configuration */}
      {step === 'chat' && (
        <div>
          <h2>Step 1: Describe Your Task</h2>
          <AIChat 
            onTaskConfigGenerated={(cfg) => {
              setConfig(cfg);
              setStep('form');
            }}
            className="h-96"
          />
        </div>
      )}

      {/* Step 2: Form Review */}
      {step === 'form' && (
        <div>
          <h2>Step 2: Review Configuration</h2>
          <TaskCreationForm initialConfig={config} />
          <button onClick={() => setStep('chat')}>Back</button>
        </div>
      )}

      {/* Step 3: Review & Submit */}
      {step === 'review' && (
        <div>
          <h2>Step 3: Confirm & Submit</h2>
          {/* Summary display */}
        </div>
      )}
    </div>
  );
}
```

## Handling AI-Generated Data

### Accepting and Validating Generated Config

```tsx
function handleTaskConfigGenerated(config: TaskConfigGenerated) {
  // Validate received config
  if (!config.functionName) {
    console.warn('Missing function name in generated config');
    return;
  }

  // Apply to form
  applyConfigToForm(config);

  // Show feedback
  showToast('Configuration generated successfully');

  // You can also process it further
  analyzeConfig(config);
}
```

### Fallback When Generation Fails

```tsx
'use client';

import { AIChat } from '@/app/components/AIChat';
import TaskCreationForm from '@/app/components/TaskCreationForm';
import { useState } from 'react';

export function RobustIntegration() {
  const [useAI, setUseAI] = useState(true);

  return (
    <>
      {useAI ? (
        <AITaskAssistant 
          showTaskForm={true}
          className="space-y-6"
        />
      ) : (
        <TaskCreationForm />
      )}

      <button 
        onClick={() => setUseAI(!useAI)}
        className="text-sm text-neutral-400"
      >
        {useAI ? 'Switch to manual form' : 'Use AI assistant'}
      </button>
    </>
  );
}
```

## State Management

### Sharing AI State Across Components

```tsx
// hooks/useTaskCreationContext.ts
import { createContext, useContext, useState } from 'react';

interface TaskCreationContextType {
  generatedConfig: any;
  setGeneratedConfig: (config: any) => void;
}

const TaskCreationContext = createContext<TaskCreationContextType | null>(null);

export function TaskCreationProvider({ children }) {
  const [generatedConfig, setGeneratedConfig] = useState(null);

  return (
    <TaskCreationContext.Provider value={{ generatedConfig, setGeneratedConfig }}>
      {children}
    </TaskCreationContext.Provider>
  );
}

export function useTaskCreation() {
  const context = useContext(TaskCreationContext);
  if (!context) {
    throw new Error('useTaskCreation must be used within TaskCreationProvider');
  }
  return context;
}
```

Usage:

```tsx
// In parent component
import { TaskCreationProvider } from '@/hooks/useTaskCreationContext';

export default function CreateTaskPage() {
  return (
    <TaskCreationProvider>
      <AITaskAssistant showTaskForm={true} />
    </TaskCreationProvider>
  );
}

// In child components
import { useTaskCreation } from '@/hooks/useTaskCreationContext';

export function MyComponent() {
  const { generatedConfig } = useTaskCreation();
  // Use config
}
```

## Styling & Customization

### Custom Theme Colors

```tsx
import { AIChat } from '@/app/components/AIChat';

export function CustomStyledChat() {
  return (
    <div className="custom-theme">
      <AIChat 
        className="!bg-custom-dark !border-custom-border"
        initialMessage="Custom greeting message"
      />
    </div>
  );
}
```

### Responsive Layouts

```tsx
// Mobile-first approach
export function ResponsiveTaskCreation() {
  return (
    <div className="flex flex-col lg:grid lg:grid-cols-2 gap-6">
      {/* Chat - stacked on mobile, left on desktop */}
      <div>
        <AIChat className="h-96 lg:h-full" />
      </div>

      {/* Form - stacked on mobile, right on desktop */}
      <div className="overflow-auto">
        <TaskCreationForm />
      </div>
    </div>
  );
}
```

## Error Handling in Integration

### Custom Error Handler

```tsx
import { AITaskAssistant } from '@/app/components/AITaskAssistant';
import { useState } from 'react';

export function ErrorHandlingExample() {
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 p-4 rounded">
          <p>{error}</p>
          <button onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <AITaskAssistant 
        showTaskForm={true}
        onError={(err) => setError(err.message)}
      />
    </>
  );
}
```

## Analytics & Tracking

### Track AI Usage

```tsx
'use client';

import { useEffect } from 'react';
import { useAIAssistant } from '@/src/hooks/useAIAssistant';

export function AnalyticsWrapper() {
  const { taskConfig, generatedABI, messages } = useAIAssistant();

  // Track when config is generated
  useEffect(() => {
    if (taskConfig) {
      analytics.track('ai_config_generated', {
        has_contract: !!taskConfig.contractAddress,
        has_function: !!taskConfig.functionName,
        interval: taskConfig.interval,
      });
    }
  }, [taskConfig]);

  // Track message count
  useEffect(() => {
    if (messages.length > 0) {
      analytics.track('ai_messages_sent', {
        count: messages.filter((m) => m.role === 'user').length,
      });
    }
  }, [messages]);

  return <AITaskAssistant showTaskForm={true} />;
}
```

## Testing Integration

### Test Component Integration

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { AITaskAssistant } from '@/app/components/AITaskAssistant';

describe('AITaskAssistant Integration', () => {
  it('should populate form when config is generated', async () => {
    render(<AITaskAssistant showTaskForm={true} />);

    // Simulate user interaction
    const input = screen.getByPlaceholderText(
      /Describe your automation task/
    );
    fireEvent.change(input, { target: { value: 'Test task' } });
    fireEvent.submit(input.closest('form')!);

    // Verify form gets populated
    await waitFor(() => {
      expect(
        screen.getByDisplayValue(/harvest/)
      ).toBeInTheDocument();
    });
  });
});
```

## Migration Guide

### From Manual Form to AI-Enhanced Form

```tsx
// Before
export function OldTaskCreation() {
  return <TaskCreationForm />;
}

// After - Add AI as optional enhancement
export function NewTaskCreation() {
  const [useAI, setUseAI] = useState(true);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button 
          onClick={() => setUseAI(true)}
          className={useAI ? 'bg-blue-600' : 'bg-gray-600'}
        >
          AI Assisted
        </button>
        <button 
          onClick={() => setUseAI(false)}
          className={!useAI ? 'bg-blue-600' : 'bg-gray-600'}
        >
          Manual Form
        </button>
      </div>

      {useAI ? (
        <AITaskAssistant showTaskForm={true} />
      ) : (
        <TaskCreationForm />
      )}
    </div>
  );
}
```

## Common Pitfalls

### ❌ Don't

```tsx
// Don't expose API key in browser code
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  headers: {
    'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY, // ❌ EXPOSED
  },
});

// Don't forget error handling
const config = await generateTaskConfig('task'); // ❌ No error handling

// Don't hardcode models
const response = await openai.chat.completions.create({
  model: 'gpt-4', // ❌ Hardcoded
});
```

### ✅ Do

```tsx
// Do use a backend API proxy
const response = await fetch('/api/ai/chat', {
  method: 'POST',
  body: JSON.stringify({ prompt }),
}); // ✅ Secure

// Do handle errors
try {
  const config = await generateTaskConfig('task');
} catch (error) {
  handleError(error); // ✅ Error handled
}

// Do use configuration
const model = process.env.NEXT_PUBLIC_OPENAI_MODEL || 'gpt-4-turbo-preview';
const response = await openai.chat.completions.create({
  model, // ✅ Configurable
});
```

## Support

For integration issues:
1. Check this guide
2. Review `AI_ASSISTANT_DOCUMENTATION.md`
3. Check `AI_ASSISTANT_SETUP.md` for configuration
4. Open an issue with integration details
