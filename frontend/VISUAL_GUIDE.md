# 🎨 Calendar Feature - Visual Guide & UX Flow

## User Interface Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                         SOROTASK HEADER                         │
│  [S] SoroTask              [Connect Wallet Button]              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   TASK SCHEDULING CALENDAR                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  < April 2024 >  [Today] [Timezone: America/New_York]   │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  Mo  Tu  We  Th  Fr  Sa  Su                             │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │  │
│  │  │  1   │ │  2   │ │  3   │ │  4   │ │  5   │ │  6   │  │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │  │
│  │                                                          │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │  │
│  │  │  7   │ │  8   │ │  9   │ │ 10   │ │ 11   │ │ 12   │  │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │  │
│  │                                                          │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │  │
│  │  │ 14   │ │ 15   │ │ 16   │ │ 17   │ │ 18   │ │ 19   │  │  │
│  │  │🔵    │ │ ● h  │ │ ● cc │ │ ● st │ │ ● cc │ │ ● h  │  │  │
│  │  │TODAY │ │ +1m  │ │ +1m  │ │      │ │ +1m  │ │ +2m  │  │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │  │
│  │                                    🟠 (orange dot)       │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  Legend:                                                 │  │
│  │  🔵 Today    ● Green: Task with deadline                │  │
│  │  🟠 Multi    🔴 Red: Overdue deadline                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Selected Date: April 15, 2024                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  harvest_yield        claim_rewards                      │  │
│  │  rebalance_portfolio                                     │  │
│  │  [Click to view details]                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      TASK DETAILS (conditionally shown)         │
├─────────────────────────────────────────────────────────────────┤
│  harvest_yield                                           [X]    │
│  task-001                                                       │
│                                                                 │
│  🟢 Active                                                      │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│  Contract Address: CAAA...                                      │
│  Description: Harvest yield from liquidity pool                │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│  SCHEDULE SETTINGS                                              │
│  Execution Interval: 1h (3600 seconds)                         │
│  Gas Balance: 10 XLM                                           │
│  Next Execution: Apr 16, 2024 10:30 AM                        │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│  DEADLINE                                                       │
│  Due Date: April 20, 2024 (America/New_York, UTC-4)            │
│  Time Until Deadline: 5 days remaining (green)                │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│  Created: April 8, 2024                                        │
│  Timezone: America/New_York                                    │
│  Tags: [automation] [yield]                                   │
│                                                                 │
│  [Edit Task]  [View Logs]                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      CREATE AUTOMATION TASK                     │
├──────────────────────────────────┐─────────────────────────────┤
│  Target Contract Address         │  YOUR TASKS                  │
│  [C...]                          │  No tasks registered yet     │
│                                  │                              │
│  Function Name                   │                              │
│  [harvest_yield]                 │                              │
│                                  │                              │
│  Interval (seconds) Gas Balance  │                              │
│  [3600]              [10]        │                              │
│                                  │                              │
│  [Register Task]                 │                              │
└──────────────────────────────────┴─────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       EXECUTION LOGS                            │
├─────────────────────────────────────────────────────────────────┤
│  Task ID  │  Target    │  Keeper   │  Status  │  Timestamp      │
│──────────┼────────────┼───────────┼──────────┼─────────────     │
│  #1024   │  CC...A12B │  GA...99X │ 🟢 Succ. │  2 mins ago      │
└─────────────────────────────────────────────────────────────────┘
```

## Interaction Flow

```
User Opens Calendar
        │
        ▼
┌─────────────────┐
│ See Month View  │
│ with Tasks      │
└────────┬────────┘
         │
    ┌────┴──────────────────────────────┐
    │                                   │
    ▼                                   ▼
┌─────────────────┐          ┌──────────────────────┐
│ Click Date      │          │ Click "+N more"      │
│ ▼               │          │ ▼                    │
│ Select Date     │          │ Show DensePopover    │
│ Show Summary    │          │ with All Tasks       │
└────────┬────────┘          └──────────┬──────────┘
         │                             │
         │                             ▼
         │                 ┌──────────────────────┐
         │                 │ Click Task in Popover│
         │                 │ ▼                    │
         │                 │ Popover Closes       │
         │                 └──────────┬───────────┘
         │                            │
         └────────┬────────────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │ Click Task          │
        │ (from summary)      │
        │ ▼                    │
        │ Open TaskDetail     │
        │ Panel               │
        └────────┬─────────────┘
                 │
                 ▼
        ┌──────────────────────┐
        │ View Full Details:   │
        │ • Status             │
        │ • Contract Address   │
        │ • Schedule Settings  │
        │ • Deadline Info      │
        │ • Timezone           │
        │ • Tags               │
        │ • Actions            │
        └────────┬─────────────┘
                 │
                 ▼
        ┌──────────────────────┐
        │ Click [Edit] or      │
        │ [View Logs] or       │
        │ [Close] to Return    │
        └──────────────────────┘
```

## Dense Date Handling Flow

```
Date with 1-2 Tasks         Date with 3+ Tasks
         │                           │
         ▼                           ▼
    ┌───────────┐              ┌─────────────┐
    │ Show all  │              │ Show first  │
    │ tasks in  │              │ 2 tasks in  │
    │ day cell  │              │ day cell    │
    └───────────┘              │ + "[+N more]│
                               │  button"    │
                               └──────┬──────┘
                                      │
                                 User Clicks
                                 "+N more"
                                      │
                                      ▼
                               ┌──────────────┐
                               │ Popover      │
                               │ Opens with   │
                               │ all tasks    │
                               │ scrollable   │
                               │              │
                               │ User Clicks  │
                               │ Task or      │
                               │ Outside      │
                               │      │       │
                               │      ▼       │
                               │ Popover     │
                               │ Closes      │
                               └──────────────┘
```

## Color Coding System

### Calendar Day Cells

```
Today (Blue Ring)           Selected Date            Out of Month
┌──────────┐               ┌──────────┐             ┌──────────┐
│ 15       │               │ 20       │             │ 28       │
│ 🔵 TODAY │               │ § SELECT │             │ GRAYED   │
└──────────┘               └──────────┘             └──────────┘

Normal Day (Neutral)        Dense Date (Orange dot)  Hover State
┌──────────┐               ┌──────────┐             ┌──────────┐
│ 10       │               │ 18       │             │ 22       │
│ ● task   │               │🟠● task  │ ◄───────► │ ¸ task   │
└──────────┘               │  ● task  │             └──────────┘
                           └──────────┘
```

### Task Status Indicators

```
🔵 Active (Blue)          🟢 Completed (Green)      🔴 Failed (Red)
─────────────             ────────────────          ──────────────
• harvest_yield           ✓ stake_tokens            ✗ liquidate

🟡 Pending (Yellow)       🟠 Paused (Orange)
────────────              ───────────────
○ claim_rewards           ⏸ rebalance
```

### Deadline Status Colors

```
Green (On Schedule)       Orange (Due Soon)         Red (Overdue)
│ 5 days remaining │     │ 0-1 days remaining │     │ 2 days overdue │
└─ Text Color ─────┘     └─ Text Color ────────┘    └─ Text Color ───┘
```

## Desktop vs Mobile Layout

### Desktop (Full Width)

```
┌─────────────────────────────────────────┐
│         Sidebar or Nav (if any)         │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐│
│  │      Calendar (Full Width)          ││
│  │  7x6 Grid (7 days, 6 weeks)         ││
│  │  Large cells with task previews     ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │    Task Details (if selected)       ││
│  │    Full information panel           ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### Tablet (Responsive)

```
┌──────────────────────────────────┐
│   Calendar (Responsive Width)    │
│   Cells slightly smaller         │
│   Still readable                 │
├──────────────────────────────────┤
│ Task Details (if selected)       │
│ Stacked below or side-by-side    │
└──────────────────────────────────┘
```

### Mobile (Compact Mode)

```
┌──────────────────┐
│ Calendar         │
│ (Compact Grid)   │
│ Smaller cells    │
│ Minimal spacing  │
├──────────────────┤
│ Task Details     │
│ (Scrollable)     │
└──────────────────┘
```

## Component Hierarchy

```
Calendar (Main)
├── Header Controls
│   ├── Month Navigation (< >)
│   ├── Today Button
│   └── Timezone Display
├── Calendar Grid
│   ├── Week Headers (Mo, Tu, We, ...)
│   └── Day Cells (7 × 6)
│       ├── CalendarDay Component
│       │   ├── Day Number
│       │   ├── Task Indicators
│       │   └── "+N more" Button
│       └── DenseTaskPopover (conditional)
│           └── Task List
├── Legend
│   ├── Today
│   ├── Task with deadline
│   ├── Multiple tasks
│   └── Overdue
└── Task Summary Panel
    └── Selected Date Tasks

TaskDetail (Separate)
├── Header with Title & Close
├── Status Badge
├── Task Information
├── Schedule Settings
├── Deadline Information
├── Additional Info
└── Action Buttons
```

## State Management Flow

```
Calendar Component State
    │
    ├─ currentDate: Date (for month view)
    ├─ selectedDate: Date | null (for task summary)
    ├─ expandedDate: string | null (for dense popover)
    │
    ├─ useMemo Dependencies:
    │  ├─ tasksByDate (from tasks prop)
    │  └─ calendarGrid (from currentDate)
    │
    └─ Event Handlers:
       ├─ goToPreviousMonth()
       ├─ goToNextMonth()
       ├─ goToToday()
       ├─ onTaskClick() ◄─ Passed to parent
       └─ onExpandClick()

Page Component State
    │
    ├─ tasks: Task[] (from mock or API)
    ├─ selectedTask: Task | null (for detail panel)
    │
    └─ Event Handlers:
       ├─ setSelectedTask (calendar click)
       └─ setSelectedTask(null) (detail close)
```

## Timezone Rendering Examples

```
Task Deadline in Different Timezones
────────────────────────────────────

Same Deadline:        December 25, 2024 6:00 PM UTC

Displayed as:
┌─────────────────────────────────────────┐
│ America/New_York: Dec 25, 1:00 PM (UTC-5) │
│ Europe/London:    Dec 25, 6:00 PM (UTC+0) │
│ Asia/Tokyo:       Dec 26, 3:00 AM (UTC+9) │
│ Australia/Sydney: Dec 26, 5:00 AM (UTC+11) │
└─────────────────────────────────────────┘

User's Local Timezone (America/New_York):
Dec 25, 1:00 PM is 4 days away ◄─ Shown in calendar
```

## Accessibility Features

```
Calendar Accessibility
├── Semantic HTML
│   ├── <button> elements
│   ├── <header>, <section>
│   └── <table> for grid (optional)
├── ARIA Labels
│   ├── aria-label="Previous month"
│   ├── aria-label="Next month"
│   └── aria-label="Tuesday, April 15, 2024"
├── Keyboard Navigation
│   ├── Tab: Navigate buttons
│   ├── Space/Enter: Activate
│   └── Arrow keys: Potential enhancement
└── Screen Reader Info
    └── Date cell announces:
        "[Day Name], [Month] [Day], [Year]"
        "[Number] task[s]"
```

## Visual Hierarchy

```
Priority 1 (Most Prominent)
├── Today button (bright blue)
├── Month/Year display (large text)
└── Day numbers (bold)

Priority 2 (Secondary)
├── Task indicators (colored dots)
├── "+N more" buttons
└── Navigation arrows

Priority 3 (Tertiary)
├── Day names (small, muted)
├── Out-of-month dates (dimmed)
└── Legend text (small)

Priority 4 (Lowest)
├── Grid lines
├── Timezone label
└── Background colors
```

## Performance Rendering

```
Mount or Update
    │
    ├─ useMemo: groupTasksByDeadline()
    │  ▼
    │  tasksByDate (cached unless tasks change)
    │
    ├─ useMemo: getMonthCalendarGrid()
    │  ▼
    │  Grid 42 dates (cached unless currentDate changes)
    │
    ├─ Render Calendar Grid
    │  ├─ CalendarDay × 42
    │  │  └─ Props: date, tasks, isToday, isSelected, etc.
    │  │
    │  └─ DenseTaskPopover (conditional)
    │     └─ Rendered only if expandedDate is set
    │
    └─ Task Summary (conditional)
       └─ Rendered only if selectedDate is set

Result: Efficient rendering with minimal re-renders
```

---

This visual guide provides a comprehensive overview of the calendar UI, interactions, components, and data flow.
