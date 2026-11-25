# Frontend Architecture Exploration Summary

## Project Overview
- **Framework**: Next.js 16.2.1 with React 19.2.4
- **Language**: TypeScript 6
- **Package Manager**: npm/pnpm
- **Node**: Uses both `app/` (App Router) and legacy structures

---

## 1. EXISTING TASK CREATION COMPONENTS

### Primary Task Creation Components

#### **TaskCreationForm** ([app/components/TaskCreationForm.tsx](app/components/TaskCreationForm.tsx))
- **Purpose**: Main form for creating automated keeper tasks
- **Location**: `/app/components/TaskCreationForm.tsx`
- **Type**: Functional component with hooks
- **Imports**: 
  - `useFormValidation` hook for validation
  - `taskCreationFormConfig` for form configuration
  - Sub-components: `FormField`, `FormSubmitButton`, `FormErrorSummary`, `DateInput`
- **Responsibilities**:
  - Render form fields for task configuration
  - Handle form validation state
  - Display validation errors
  - Submit task to backend

#### **TaskForm** ([app/components/TaskForm.tsx](app/components/TaskForm.tsx))
- **Purpose**: Simpler alternative form for task creation
- **Type**: Functional component with local state (useState)
- **Handles**: Basic task configuration (address, function, interval, gas)
- **Interface**: `TaskFormValues` with properties:
  - `targetAddress`: Contract address
  - `functionName`: Smart contract function name
  - `intervalSeconds`: Execution interval
  - `gasBalance`: XLM gas balance
- **Styling**: Uses inline Tailwind classes with dark theme (neutral-900, blue-500)

#### **Task Management Components** (in [components/](components/) directory)
- `TaskCard.tsx` - Display individual tasks
- `TaskCardWithSelection.tsx` - Card with selection capability
- `TaskDetail.tsx` - Detailed view of task
- `TaskDetailModal.tsx` - Modal for task details
- `TaskDependencyManager.tsx` - Manage task dependencies
- `DenseTaskPopover.tsx` - Compact popover view

### Related Form Components

#### **Form Field Components** ([app/components/form/](app/components/form/))
- **FormField.tsx**: Generic form input wrapper with:
  - Validation state display
  - Error/warning messages
  - Support for text, number, email, password, textarea
  - Help text and error summaries
  
- **FormSubmitButton.tsx**: Smart submit button with:
  - Loading state indicator
  - Disabled state for invalid forms
  - Custom loading text
  
- **FormErrorSummary.tsx**: Displays all form errors at once

#### **DateInput Component** ([app/components/DateInput.tsx](app/components/DateInput.tsx))
- Specialized date picker for task due dates
- Integrated with form validation
- Parses and formats dates

---

## 2. COMPONENT HIERARCHY & ARCHITECTURE PATTERNS

### Directory Structure
```
frontend/
├── app/                          # Next.js App Router
│   ├── components/              # Page-specific and reusable components
│   │   ├── form/                # Form field components
│   │   ├── TaskCreationForm.tsx
│   │   ├── TaskForm.tsx
│   │   └── ...
│   ├── utils/                   # Utilities and helpers
│   │   ├── formValidation/      # Validation logic
│   │   │   ├── formConfigs.ts   # Form configuration
│   │   │   ├── useFormValidation.ts  # Validation hook
│   │   │   ├── validators.ts    # Validator functions
│   │   │   └── types.ts         # Type definitions
│   │   └── dateConfig.ts
│   ├── Zustand/                 # Zustand store (notifications)
│   ├── tasks/                   # Task pages
│   └── board/                   # Board pages
├── components/                  # Global components
│   ├── board/                   # Board-specific components
│   ├── transaction/             # Transaction components
│   └── ...
├── context/                     # React Context API
│   ├── AuthContext.tsx
│   └── LocaleContext.tsx
├── store/                       # Global state (Zustand)
│   └── useAppStore.ts
├── hooks/                       # Custom hooks
│   ├── useI18n.ts
│   ├── useSearch.ts
│   ├── useSharing.ts
│   └── ...
├── lib/                         # Library functions
│   ├── task-client.ts           # API client for tasks
│   └── ...
└── src/                         # Alternative source structure
    ├── lib/
    ├── components/
    └── types/
```

### Component Pattern

**Typical Component Structure:**
```tsx
'use client';  // Client component directive for interactivity

import React from 'react';
import { useHook } from '@/hooks';
import { SubComponent } from './SubComponent';

interface ComponentProps {
  // Props definition
}

export function ComponentName({ ...props }: ComponentProps) {
  // Hook usage
  // State management
  // Event handlers
  
  return (
    // JSX with Tailwind classes
  );
}
```

**Key Patterns:**
1. **Client Components**: Marked with `'use client'` for interactive forms
2. **Server Components**: Default in App Router for data fetching
3. **Composition**: Small, focused components combined into larger features
4. **Props-driven**: Configuration through props rather than context for form fields

---

## 3. STATE MANAGEMENT APPROACH

### Zustand Store
**Primary Store**: [store/useAppStore.ts](store/useAppStore.ts)

**App State Structure:**
```typescript
interface AppState {
  // Wallet State
  isWalletConnected: boolean;
  walletAddress: string | null;
  connectWallet: () => void;
  disconnectWallet: () => void;

  // Task State
  tasks: Task[];
  addTask: (task: Omit<Task, 'id'>) => void;

  // Log State
  logs: Log[];
  addLog: (log: Omit<Log, 'id' | 'timestamp'>) => void;
}
```

**Secondary Store**: [app/Zustand/Store.ts](app/Zustand/Store.ts)
- Manages notifications
- Uses Zustand's `create()` pattern

**Store Features:**
- Slice-based organization (Wallet, Task, Log slices)
- ID auto-generation for new items
- Timestamp management
- Mock data for initial state

### React Context API
**AuthContext** ([context/AuthContext.tsx](context/AuthContext.tsx))
- Authentication state
- User session management
- Wallet connection handling

**LocaleContext** ([context/LocaleContext.tsx](context/LocaleContext.tsx))
- Internationalization (i18n)
- Language/locale selection
- Format preferences

### Form Validation State
**useFormValidation Hook** ([app/utils/formValidation/useFormValidation.ts](app/utils/formValidation/useFormValidation.ts))
- Manages form-specific state
- Tracks touched fields
- Handles async validation
- Debounces validation
- Provides error and warning lists

**Form State Structure:**
```typescript
interface FormState<T> {
  values: T;
  errors: Record<keyof T, string[]>;
  warnings: Record<keyof T, string[]>;
  touched: Record<keyof T, boolean>;
  validating: Record<keyof T, boolean>;
  isValid: boolean;
  isDirty: boolean;
  isSubmitting: boolean;
  isSubmitted: boolean;
}
```

---

## 4. API/SERVICE LAYER STRUCTURE

### Task API Client
**File**: [src/lib/task-client.ts](src/lib/task-client.ts)

**API Operations:**
```typescript
// Fetch all tasks
export const fetchTasks = async (): Promise<Task[]>

// Create new task
export const createTask = async (task: TaskCreate): Promise<Task>

// Update existing task
export const updateTask = async (
  taskId: string, 
  changes: Partial<TaskCreate>
): Promise<Task>

// Delete task
export const deleteTask = async (taskId: string): Promise<string>

// Reorder tasks
export const moveTask = async (
  taskId: string, 
  direction: -1 | 1
): Promise<Task[]>

// Reset to initial state
export const resetTasks = (): void
```

**Implementation Details:**
- **Current**: Mock implementation with in-memory storage
- **Strategy**: Simulates API delays (200-300ms)
- **Data Persistence**: `persistedTasks` array in module scope
- **Error Handling**: Throws errors for invalid operations

**Task Types:**
```typescript
export type Task = {
  id: string
  target: string           // Contract address
  func: string            // Function name
  interval: number        // Interval in seconds
  balance: number         // Gas balance
  status: 'pending' | 'active' | 'completed' | 'cancelled'
}

export type TaskCreate = Omit<Task, 'id' | 'status'>
```

### API Routes
**Location**: [app/api/auth/](app/api/auth/)
- **NextAuth Configuration**: Route handler at `[...nextauth]/`
- **Auth Provider**: next-auth@5.0.0-beta.31
- **Session Management**: NextAuth server-side sessions

### Backend Communication Pattern
1. **API Client**: Exports async functions for CRUD operations
2. **Error Handling**: Throws errors that bubble to components
3. **Loading States**: Components manage loading state locally
4. **Data Transformation**: Type-safe with TypeScript interfaces

---

## 5. STYLING APPROACH

### Tailwind CSS Configuration
**File**: [tailwind.config.js](tailwind.config.js)

**Color Palette:**
- **Primary**: Blue (50, 500, 600, 700) - #3b82f6
- **Neutral**: Full spectrum (50-950) - Dark theme focus
  - Neutral-900: #171717 (background)
  - Neutral-800: #262626 (cards)
  - Neutral-400: #9ca3af (text)
- **Semantic Colors**: 
  - Success: #10b981
  - Warning: #f59e0b
  - Error: #ef4444
  - Info: #0ea5e9

**Theme Features:**
- Dark mode optimized (no light mode found)
- Extended shadows for depth
- Custom spacing scale
- Responsive design with breakpoints (mobile-first)

### Styling Patterns

**Input Fields:**
```tsx
const inputClass = `
  w-full bg-neutral-900 border border-neutral-700/50 
  rounded-lg px-4 py-2 
  focus:ring-2 focus:ring-blue-500 focus:border-blue-500 
  outline-none transition-all font-mono text-sm
`
```

**Form Containers:**
```tsx
className="bg-neutral-800/50 border border-neutral-700/50 
           rounded-xl p-6 space-y-4 shadow-xl"
```

**Text Colors:**
- Labels: `text-neutral-400` (lighter gray)
- Text: `text-neutral-100` (nearly white)
- Secondary: `text-neutral-500` (medium gray)

### CSS-in-JS
- **No styled-components or Emotion**: Uses Tailwind classes directly
- **PostCSS**: Configured via `postcss.config.mjs`
- **CSS Files**: Design tokens in `app/design-tokens.css`

---

## 6. TESTING SETUP & PATTERNS

### Testing Configuration

**Jest Setup**: [jest.config.js](jest.config.js)
- **Test Environment**: jsdom (simulates browser)
- **Coverage Threshold**: 70% (branches, functions, lines, statements)
- **Test Files Pattern**:
  - `app/**/*.{spec,test}.{js,jsx,ts,tsx}`
  - `app/**/__tests__/**/*.{js,jsx,ts,tsx}`
  - `src/**/*.{spec,test}.{js,jsx,ts,tsx}`
  - `src/**/__tests__/**/*.{js,jsx,ts,tsx}`

**Jest Setup File**: [jest.setup.js](jest.setup.js)
- **Testing Library Integration**: `@testing-library/jest-dom`
- **Mocked Modules**:
  - `next/router` - Router navigation
  - `next/image` - Image optimization (mocked to `<img>`)
  - `console.warn` - Suppresses Tiptap duplicate extension warnings
- **Environment Variables**: `NEXT_PUBLIC_API_URL = 'http://localhost:3000'`

### Testing Libraries

**Primary Libraries:**
```json
{
  "@testing-library/react": "^16.0.0",
  "@testing-library/jest-dom": "^6.4.2",
  "@testing-library/dom": "^10.4.1",
  "jest": "^29.7.0",
  "jest-environment-jsdom": "^29.7.0"
}
```

**Storybook**: Version ^8.6.18
- **Config**: `.storybook/` directory
- **Usage**: Component documentation and visual testing
- **Examples**: `.stories.tsx` files (e.g., `Button.stories.tsx`)

### Testing Patterns

**Dialog Component Test** ([components/__tests__/Dialog.test.tsx](components/__tests__/Dialog.test.tsx))
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '@/components/Dialog';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} onClose={jest.fn()} title="Test">
        <p>body</p>
      </Dialog>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders panel when open', () => {
    render(
      <Dialog open onClose={jest.fn()} title="Test">
        <p>body</p>
      </Dialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

**Key Testing Patterns:**
1. **Query Assertions**: `getByRole`, `queryByRole`, `getByText`
2. **User Interaction**: `fireEvent`, simulating clicks and input
3. **Async Testing**: `waitFor`, `findBy` for async operations
4. **ARIA Testing**: Role-based queries for accessibility
5. **Mock Functions**: `jest.fn()` for callbacks and handlers
6. **Snapshot Testing**: Not heavily used, behavior-focused

### Test Organization
- **`__tests__/` Directories**: Component tests colocated
- **Test Structure**: Describe/it blocks with clear test names
- **Mocking**: Jest mocks for external dependencies
- **Assertions**: Emphasis on user-visible behavior

---

## 7. FORM VALIDATION ARCHITECTURE

### Validation Configuration
**File**: [app/utils/formValidation/formConfigs.ts](app/utils/formValidation/formConfigs.ts)

**Task Creation Form Config:**
```typescript
export const taskCreationFormConfig: FormConfig = {
  fields: {
    contractAddress: {
      name: 'contractAddress',
      initialValue: '',
      validation: [
        required('Contract address is required'),
        contractAddress()  // Custom validator
      ],
      asyncValidation: async (address) => {
        // Verify contract exists on-chain
      },
      debounceMs: 500,
      required: true,
      placeholder: 'C...',
      type: 'text'
    },
    functionName: { /* ... */ },
    interval: { /* ... */ },
    gasBalance: { /* ... */ },
    dueDate: { /* ... */ }
  },
  validateOnChange: true,
  validateOnBlur: true,
  focusFirstError: true,
  resetOnSubmit: false,
  onSubmit: async (values) => {
    // Handle form submission
  }
};
```

### Validator Functions
**File**: [app/utils/formValidation/validators.ts](app/utils/formValidation/validators.ts)

**Available Validators:**
```typescript
required(message?)              // Non-empty value
minLength(min, message?)        // String length
maxLength(max, message?)        // String length
email(message?)                 // Email format
pattern(regex, message?)        // Regex matching
number(message?)                // Valid number
min(min, message?)              // Numeric minimum
max(max, message?)              // Numeric maximum
positive(message?)              // Positive numbers
nonNegative(message?)           // Non-negative
integer(message?)               // Whole numbers
url(message?)                   // URL format
ethereumAddress(message?)       // Ethereum address format
contractAddress()               // Stellar contract validation
functionName()                  // Valid function name (alphanumeric + underscore)
intervalSeconds()               // Valid interval (≥60 seconds)
gasBalance()                    // Valid balance (0.1-10000 XLM)
```

### Validator Interface
```typescript
type ValidationRule = {
  validate: (value: any) => {
    isValid: boolean;
    message?: string;
  };
  required?: boolean;
};
```

---

## 8. KEY FILE INVENTORY

### Core Task Management
| File | Purpose |
|------|---------|
| [src/lib/task-client.ts](src/lib/task-client.ts) | Task CRUD API client |
| [store/useAppStore.ts](store/useAppStore.ts) | Global app state (Zustand) |
| [app/components/TaskCreationForm.tsx](app/components/TaskCreationForm.tsx) | Main task creation form |
| [app/components/TaskForm.tsx](app/components/TaskForm.tsx) | Alternative task form |

### Form Validation & Handling
| File | Purpose |
|------|---------|
| [app/utils/formValidation/useFormValidation.ts](app/utils/formValidation/useFormValidation.ts) | Form state hook |
| [app/utils/formValidation/formConfigs.ts](app/utils/formValidation/formConfigs.ts) | Form configurations |
| [app/utils/formValidation/validators.ts](app/utils/formValidation/validators.ts) | Validation rules |
| [app/components/form/FormField.tsx](app/components/form/FormField.tsx) | Input wrapper with validation |
| [app/components/form/FormSubmitButton.tsx](app/components/form/FormSubmitButton.tsx) | Smart submit button |

### Context & State
| File | Purpose |
|------|---------|
| [context/AuthContext.tsx](context/AuthContext.tsx) | Authentication context |
| [context/LocaleContext.tsx](context/LocaleContext.tsx) | Internationalization context |
| [app/Zustand/Store.ts](app/Zustand/Store.ts) | Notification store |

### Configuration
| File | Purpose |
|------|---------|
| [package.json](package.json) | Dependencies & scripts |
| [tailwind.config.js](tailwind.config.js) | Tailwind theme & design tokens |
| [jest.config.js](jest.config.js) | Jest testing configuration |
| [tsconfig.json](tsconfig.json) | TypeScript configuration |
| [next.config.ts](next.config.ts) | Next.js configuration |

---

## 9. ARCHITECTURE SUMMARY

### Technology Stack
- **Framework**: Next.js 16.2.1 (App Router)
- **UI Library**: React 19.2.4
- **State Management**: Zustand (global) + React Hooks (local)
- **Context**: React Context API (Auth, i18n)
- **Styling**: Tailwind CSS v4
- **Forms**: Custom validation hook pattern
- **Testing**: Jest + React Testing Library
- **Type System**: TypeScript 6

### Data Flow
1. **User Input** → Form Component
2. **Validation** → useFormValidation Hook
3. **API Call** → task-client.ts functions
4. **State Update** → Zustand store or local state
5. **Re-render** → Component updates

### Key Design Decisions
1. **No Form Library**: Custom hook-based validation
2. **Zustand over Redux**: Simpler, unopinionated state management
3. **Tailwind over CSS Modules**: Utility-first styling approach
4. **Context + Hooks**: For authentication and preferences
5. **Mock API Layer**: Ready for real backend integration
6. **Accessibility First**: ARIA attributes in components

---

## 10. INTEGRATION POINTS FOR AI-POWERED ASSISTANT

### Recommended Integration Areas

1. **TaskCreationForm Component**
   - Add AI field validation suggestions
   - Provide function signature hints
   - Suggest optimal intervals based on history

2. **Form Validation System**
   - Custom validators for AI-powered analysis
   - Real-time suggestions as user types
   - Async validation for contract verification

3. **API Layer**
   - Replace mock with real backend calls
   - Add request/response interceptors
   - Error handling and retry logic

4. **State Management**
   - Extend Zustand store for AI features
   - Track user preferences
   - Store configuration presets

5. **UI Components**
   - Add AI suggestion tooltips
   - Implement context-aware help panels
   - Create wizard flows for complex configurations

