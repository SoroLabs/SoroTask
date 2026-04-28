git checkout -b feat/responsive-board-layout-scales-cleanly-mobile-tablet# Calendar Feature: Task Scheduling & Deadline Management

## Overview

The Calendar feature provides a comprehensive scheduling interface for task management with deadline tracking, timezone support, and intelligent handling of dense date cells (multiple tasks on the same date). This implementation enables users to visualize their task workload across time with a modern, responsive calendar UI.

## Architecture

### Components

#### 1. **Calendar.tsx** (Main Component)
The primary calendar component that orchestrates all calendar functionality.

**Features:**
- Month-view calendar grid with week navigation
- Task grouping by deadline date
- Month/year navigation with "Today" quick jump
- Task selection and detailed view
- Timezone display
- Dense task popover for dates with 3+ tasks
- Task summary panel for selected dates

**Props:**
```typescript
interface CalendarProps {
  tasks: Task[];                          // Array of tasks to display
  onTaskClick?: (task: Task) => void;    // Callback when task is clicked
  locale?: string;                       // BCP 47 language tag (default: 'en-US')
  timezone?: string;                     // IANA timezone (default: user's timezone)
  compact?: boolean;                     // Compact view mode (default: false)
}
```

#### 2. **CalendarDay.tsx** (Day Cell Component)
Individual day cell within the calendar grid.

**Features:**
- Day number display
- Task indicators with status colors
- "More tasks" button for dates with 3+ tasks
- Hover states and selection highlighting
- Color-coded task indicators:
  - Green: Normal deadline
  - Red: Overdue deadline
  - Orange: Multiple tasks on same date
  - Blue: Today indicator

#### 3. **DenseTaskPopover.tsx** (Dense Date Handler)
Popover menu that appears when clicking "+N more" or a dense date cell.

**Features:**
- Displays all tasks for a date
- Task status indicators
- Task details preview (ID, function name, interval, gas balance)
- Click-outside detection for closing
- Scrollable task list with max-height
- Task selection with automatic popover close

#### 4. **TaskDetail.tsx** (Task Detail View)
Comprehensive task information panel.

**Features:**
- Full task metadata display
- Deadline information with countdown
- Contract address and function details
- Schedule settings (interval, gas balance)
- Next execution time
- Creation date and timezone info
- Tags support
- Action buttons (Edit, View Logs)
- Status badge with color coding
- Timezone-aware date formatting

### Utilities

#### **lib/dateUtils.ts**
Date manipulation and formatting utilities.

**Key Functions:**
- `formatDateKey(date)` - Format as 'YYYY-MM-DD' for grouping
- `parseDateKey(key)` - Parse 'YYYY-MM-DD' back to Date
- `getDaysInMonth(year, month)` - Get all days in a month
- `getMonthCalendarGrid(year, month)` - Get 42-cell grid (6 weeks × 7 days)
- `isSameDay(date1, date2)` - Check if dates are the same day
- `isToday(date)` - Check if date is today
- `isPastDate(date)` - Check if date is in the past
- `isFutureDate(date)` - Check if date is in the future
- `formatDate(date, options)` - Format with locale and timezone
- `addDays(date, days)` - Add days to a date
- `addMonths(date, months)` - Add months to a date
- `getDaysDifference(date1, date2)` - Get day count between dates
- `isDateInRange(date, start, end)` - Check if date is within range
- `getDayName(index, options)` - Get localized day name
- `getMonthName(month, options)` - Get localized month name

#### **lib/timezoneUtils.ts**
Timezone handling and conversion utilities.

**Key Functions:**
- `getUserTimezone()` - Get user's current timezone
- `isValidTimezone(tz)` - Validate timezone string
- `getAvailableTimezones()` - Get common timezones
- `getTimezoneOffset(tz, date)` - Get UTC offset display
- `formatTimeInTimezone(date, tz, locale)` - Format time in timezone
- `formatDateWithTimezone(date, options)` - Format date with timezone info
- `getCurrentTimeInTimezone(tz)` - Get current time in timezone
- `getTimezonesByRegion(region)` - Get timezones by region
  - North America
  - South America
  - Europe
  - Africa
  - Asia
  - Pacific/Oceania

### Type Definitions

#### **types/task.ts**

```typescript
interface Task {
  id: string;                  // Unique task identifier
  contractAddress: string;     // Soroban contract address
  functionName: string;        // Function to execute
  interval: number;            // Execution interval in seconds
  gasBalance: number;          // Gas balance in XLM
  createdAt: Date;            // Task creation date
  deadline?: Date;            // Optional deadline
  nextExecutionTime?: Date;   // Scheduled next execution
  status: TaskStatus;         // Current task status
  description?: string;       // Task description
  timezone?: string;          // IANA timezone
  tags?: string[];            // Task tags
}

type TaskStatus = 'pending' | 'active' | 'completed' | 'failed' | 'paused';

interface TasksByDate {
  [dateKey: string]: Task[];  // Tasks grouped by YYYY-MM-DD
}
```

## Usage Example

```tsx
'use client';
import Calendar from '@/components/Calendar';
import TaskDetail from '@/components/TaskDetail';
import { Task } from '@/types/task';
import { useState } from 'react';

export default function SchedulePage() {
  const [tasks, setTasks] = useState<Task[]>([...]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  return (
    <>
      <Calendar
        tasks={tasks}
        onTaskClick={setSelectedTask}
        locale="en-US"
        timezone="America/New_York"
      />
      
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          timezone="America/New_York"
          locale="en-US"
        />
      )}
    </>
  );
}
```

## Features

### ✅ Acceptance Criteria Met

1. **Users can view tasks on a calendar**
   - Month-view calendar displays all tasks with deadlines
   - Tasks color-coded by status
   - Past deadlines highlighted in red
   - Current day highlighted in blue

2. **Dense dates remain readable and navigable**
   - Maximum 2 task previews per day cell
   - "+N more" button for dates with 3+ tasks
   - Popover shows full task list for dense dates
   - Task details accessible via drill-down

3. **Clicking a calendar entry opens correct task context**
   - Calendar day click selects date
   - Task preview click opens popover
   - Task clicks in popover open full task detail
   - Task detail panel shows all metadata

4. **Date rendering consistent with app locale settings**
   - Intl.DateTimeFormat for localized date/time display
   - Timezone-aware formatting
   - Configurable locale via props
   - Fallback to en-US if not specified

### Additional Features

- **Timeline Information**
  - Days until deadline countdown
  - Overdue status with days count
  - Next execution time display
  - Task execution interval display

- **Timezone Support**
  - User's current timezone auto-detection
  - Configurable per-task timezone
  - UTC offset display
  - Multi-region timezone lists

- **Task Status Indicators**
  - Color-coded status badges
  - Visual indicators: pending, active, completed, failed, paused
  - Status reflected in day cell colors

- **Navigation**
  - Previous/Next month buttons
  - "Today" quick jump
  - Month/year display
  - Week navigation implicit in grid

- **Responsive Design**
  - Full-width calendar on mobile
  - Adjustable cell sizing with compact mode
  - Touch-friendly popover interactions
  - Proper z-indexing for overlays

## Testing

Comprehensive test suite included:

### Date Utils Tests (`__tests__/dateUtils.test.ts`)
- Date key formatting/parsing
- Month calculations
- Day comparisons
- Range checking
- Month grid generation

### Timezone Utils Tests (`__tests__/timezoneUtils.test.ts`)
- Timezone validation
- Offset calculations
- Format conversions
- Region lookups

### Calendar Component Tests (`__tests__/Calendar.test.tsx`)
- Rendering verification
- Navigation functionality
- Month/year display
- Timezone display
- Task display
- Click handlers
- Empty state handling

**Run tests:**
```bash
cd frontend
npm test
```

## Styling

Calendar uses Tailwind CSS for styling with:
- Dark theme (neutral-900 background)
- Blue accents for interactive elements
- Color-coded status indicators
- Hover states for interactivity
- Ring-based focus states
- Smooth transitions

## Locale & Timezone Support

### Locales
- Uses `Intl.DateTimeFormat` for proper locale support
- Configurable via `locale` prop
- Defaults to 'en-US'

### Timezones
- 14 common timezones pre-configured
- 6 geographic regions with timezone lists
- IANA timezone validation
- Per-task timezone settings
- Auto-detection of user timezone

## Future Enhancements

Potential improvements:
- [ ] Week view mode
- [ ] Agenda/list view mode
- [ ] Task filtering/search
- [ ] Recurring task support
- [ ] Calendar event creation directly from UI
- [ ] Drag-and-drop task rescheduling
- [ ] Multi-timezone comparison view
- [ ] Deadline notifications/alerts
- [ ] Calendar sync (iCal export)
- [ ] Task workload analytics
- [ ] Custom color themes per task type
- [ ] Bulk operations on selected dates

## Browser Compatibility

- Modern browsers with:
  - ES2017+ support
  - Intl API support (date/time formatting)
  - CSS Grid support
  - React 19+ support

## Performance Considerations

- Efficient task grouping via useMemo
- Grid calculation cached
- Date operations avoid unnecessary object creation
- Popover rendered only when needed
- Event delegation where possible

## Accessibility

- Semantic HTML buttons and labels
- ARIA labels for navigation
- Keyboard support for date selection
- Screen reader friendly date formats
- High contrast color indicators
- Focus ring styling for keyboard navigation
