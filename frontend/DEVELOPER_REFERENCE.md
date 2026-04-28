# Calendar Feature - Developer Quick Reference

## Quick Links

- **Main Calendar Component**: [components/Calendar.tsx](./components/Calendar.tsx)
- **Full Documentation**: [CALENDAR_FEATURE.md](./CALENDAR_FEATURE.md)
- **Implementation Summary**: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
- **Quick Start**: [QUICKSTART_CALENDAR.sh](./QUICKSTART_CALENDAR.sh)

## Essential Imports

```typescript
// Main components
import Calendar from '@/components/Calendar';
import TaskDetail from '@/components/TaskDetail';
import CalendarDay from '@/components/CalendarDay';
import DenseTaskPopover from '@/components/DenseTaskPopover';

// Types
import { Task, TaskStatus, TasksByDate } from '@/types/task';

// Date utilities
import {
  formatDateKey,
  isSameDay,
  isToday,
  isPastDate,
  addDays,
  getMonthCalendarGrid,
} from '@/lib/dateUtils';

// Timezone utilities
import {
  getUserTimezone,
  isValidTimezone,
  formatDateWithTimezone,
} from '@/lib/timezoneUtils';

// Calendar helpers
import {
  groupTasksByDeadline,
  findOverdueTasks,
  getTaskStatusColor,
} from '@/lib/calendarHelpers';
```

## Common Tasks

### Display a Calendar

```tsx
<Calendar
  tasks={tasks}
  onTaskClick={handleTaskClick}
  locale="en-US"
  timezone="America/New_York"
/>
```

### Show Task Details

```tsx
{selectedTask && (
  <TaskDetail
    task={selectedTask}
    onClose={() => setSelectedTask(null)}
    timezone="America/New_York"
  />
)}
```

### Format a Date for Calendar

```typescript
import { formatDateKey } from '@/lib/dateUtils';

const dateKey = formatDateKey(new Date()); // "2024-04-27"
```

### Check If Date is Today

```typescript
import { isToday } from '@/lib/dateUtils';

if (isToday(taskDeadline)) {
  console.log('Task is due today!');
}
```

### Group Tasks by Deadline

```typescript
import { groupTasksByDeadline } from '@/lib/calendarHelpers';

const grouped = groupTasksByDeadline(tasks);
// { "2024-04-27": [...], "2024-04-28": [...] }
```

### Find Overdue Tasks

```typescript
import { findOverdueTasks } from '@/lib/calendarHelpers';

const overdue = findOverdueTasks(tasks);
```

### Format Date for Timezone

```typescript
import { formatDateWithTimezone } from '@/lib/timezoneUtils';

const formatted = formatDateWithTimezone(date, {
  timezone: 'America/New_York',
  locale: 'en-US',
  includeTime: true
});
```

## Component Props Reference

### Calendar Props

```typescript
interface CalendarProps {
  tasks: Task[];                    // Array of tasks
  onTaskClick?: (task: Task) => void;  // Task selection handler
  locale?: string;                  // e.g. 'en-US', 'es-ES', 'de-DE'
  timezone?: string;                // IANA timezone
  compact?: boolean;                // Smaller cell sizes
}
```

### CalendarDay Props

```typescript
interface CalendarDayProps {
  date: Date;                       // Day to display
  tasks: Task[];                    // Tasks for this day
  isCurrentMonth: boolean;          // Is this month's day
  isToday: boolean;                 // Is today
  isSelected: boolean;              // Is selected by user
  compact?: boolean;                // Compact mode
  onSelect?: (date: Date) => void;  // Day click handler
  onTaskClick?: (task: Task) => void;  // Task click handler
  onExpandClick?: () => void;       // Expand button handler
}
```

### TaskDetail Props

```typescript
interface TaskDetailProps {
  task: Task;                       // Task to display
  onClose?: () => void;             // Close handler
  timezone?: string;                // IANA timezone
  locale?: string;                  // BCP 47 language tag
}
```

## Task Type Reference

```typescript
interface Task {
  id: string;                   // Unique ID
  contractAddress: string;      // Soroban contract
  functionName: string;         // Function to call
  interval: number;             // Interval in seconds
  gasBalance: number;           // Gas in XLM
  createdAt: Date;             // Creation date
  deadline?: Date;             // Optional deadline
  nextExecutionTime?: Date;    // Next scheduled run
  status: TaskStatus;          // Current status
  description?: string;        // Description
  timezone?: string;           // IANA timezone
  tags?: string[];            // Task tags
}

type TaskStatus = 'pending' | 'active' | 'completed' | 'failed' | 'paused';
```

## Utility Functions Quick Reference

### dateUtils.ts

| Function | Purpose | Example |
|----------|---------|---------|
| `formatDateKey(date)` | Format as YYYY-MM-DD | `formatDateKey(new Date())` → `"2024-04-27"` |
| `isSameDay(d1, d2)` | Compare dates | `isSameDay(date1, date2)` → boolean |
| `isToday(date)` | Check if today | `isToday(deadline)` → boolean |
| `isPastDate(date)` | Check if past | `isPastDate(deadline)` → boolean |
| `addDays(date, n)` | Add days | `addDays(today, 5)` → Date 5 days later |
| `addMonths(date, n)` | Add months | `addMonths(date, 1)` → Date next month |
| `getDaysDifference(d1, d2)` | Days between | `getDaysDifference(end, start)` → number |
| `formatDate(date, opts)` | Format date | `formatDate(date, {format: 'long'})` |
| `getMonthCalendarGrid(y, m)` | Get month grid | Returns 42-cell array |

### timezoneUtils.ts

| Function | Purpose | Example |
|----------|---------|---------|
| `getUserTimezone()` | Get user's TZ | `"America/New_York"` |
| `isValidTimezone(tz)` | Validate timezone | `isValidTimezone("America/New_York")` → true |
| `getAvailableTimezones()` | Get common TZs | Returns 14 timezones |
| `formatDateWithTimezone()` | Format with TZ | Date with timezone offset |
| `getTimezoneOffset(tz)` | Get UTC offset | `"UTC-5"` or `"GMT-0500"` |

### calendarHelpers.ts

| Function | Purpose |
|----------|---------|
| `groupTasksByDeadline(tasks)` | Group by deadline |
| `sortTasksByStatus(tasks)` | Sort by status priority |
| `findOverdueTasks(tasks)` | Find past deadlines |
| `findTasksDueSoon(tasks, days)` | Find upcoming deadlines |
| `calculateDateWorkload(tasks)` | Get workload score |
| `getTaskStatusColor(status)` | Get Tailwind color class |
| `exportTasksAsCSV(tasks)` | Export to CSV |

## Styling Classes

### Calendar Colors

- **Today**: `bg-blue-500/20 border-blue-400/50`
- **Selected**: `bg-neutral-700/50 border-neutral-500/50`
- **Hover**: `hover:bg-neutral-800/50`
- **Out of month**: `bg-neutral-900/30 opacity-40`

### Task Status Colors

- **Active**: `text-blue-400`, `bg-blue-500/10`
- **Completed**: `text-green-400`, `bg-green-500/10`
- **Failed**: `text-red-400`, `bg-red-500/10`
- **Pending**: `text-yellow-400`, `bg-yellow-500/10`
- **Paused**: `text-orange-400`, `bg-orange-500/10`

## Common Patterns

### Control Month View

```typescript
const [currentMonth, setCurrentMonth] = useState(new Date());

const handlePrevMonth = () => {
  setCurrentMonth(prev => addMonths(prev, -1));
};

const handleNextMonth = () => {
  setCurrentMonth(prev => addMonths(prev, 1));
};
```

### Filter Tasks by Status

```typescript
import { filterTasksByStatus } from '@/lib/calendarHelpers';

const activeTasks = filterTasksByStatus(tasks, 'active');
const completedTasks = filterTasksByStatus(tasks, 'completed');
```

### Find Overdue Tasks

```typescript
import { findOverdueTasks } from '@/lib/calendarHelpers';

const overdue = findOverdueTasks(tasks);
overdue.forEach(task => {
  console.log(`${task.functionName} is overdue`);
});
```

### Format Deadline Display

```typescript
import { getDaysDifference, formatDate } from '@/lib/dateUtils';

if (task.deadline) {
  const daysLeft = getDaysDifference(task.deadline, new Date());
  const displayDate = formatDate(task.deadline, {
    format: 'long',
    locale: 'en-US'
  });
  
  console.log(`${displayDate}: ${daysLeft} days remaining`);
}
```

## Testing Patterns

### Test Calendar Rendering

```typescript
import { render, screen } from '@testing-library/react';
import Calendar from '@/components/Calendar';

it('renders calendar', () => {
  render(<Calendar tasks={[]} />);
  expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
});
```

### Test Date Utilities

```typescript
import { isSameDay, isToday } from '@/lib/dateUtils';

describe('dateUtils', () => {
  it('should check if dates are same day', () => {
    const date1 = new Date(2024, 0, 15);
    const date2 = new Date(2024, 0, 15);
    expect(isSameDay(date1, date2)).toBe(true);
  });
});
```

## Performance Tips

1. **Memoize task grouping**
   ```typescript
   const tasksByDate = useMemo(
     () => groupTasksByDeadline(tasks),
     [tasks]
   );
   ```

2. **Avoid re-renders**
   - Use `React.memo` for CalendarDay
   - Pass only necessary props
   - Memoize callbacks with `useCallback`

3. **Optimize timezone checks**
   - Cache `getUserTimezone()` result
   - Validate timezones once on load

## Debugging Tips

### Check Calendar Grid

```typescript
import { getMonthCalendarGrid } from '@/lib/dateUtils';

const grid = getMonthCalendarGrid(2024, 4);
console.log(grid); // 42 dates in 6 weeks
```

### Verify Task Grouping

```typescript
import { groupTasksByDeadline } from '@/lib/calendarHelpers';

const grouped = groupTasksByDeadline(tasks);
console.log(Object.keys(grouped)); // All date keys
```

### Check Timezone Validity

```typescript
import { isValidTimezone } from '@/lib/timezoneUtils';

console.log(isValidTimezone('America/New_York')); // true
console.log(isValidTimezone('Invalid/Zone')); // false
```

## Resources

- [MDN: Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)
- [IANA Timezone Database](https://www.iana.org/time-zones)
- [Tailwind CSS](https://tailwindcss.com)
- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)

## Support

For issues or questions:
1. Check CALENDAR_FEATURE.md for detailed docs
2. Review test files for usage examples
3. Check component inline comments
4. Create an issue on the repository
