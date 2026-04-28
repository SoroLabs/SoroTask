# Time Tracking Feature

This feature adds integrated time tracking capabilities to SoroTask, allowing users to log work time against automation tasks for reporting and billing purposes.

## Features

### Manual Time Entry
- Add time manually with hours and minutes
- Include optional descriptions
- Validation prevents invalid entries (negative time, >24 hours)

### Active Timer
- Start, pause, and stop timers for tasks
- Only one timer can be active at a time
- Visual indicator shows current active timer
- Automatic time calculation

### Task-Level Tracking
- Accumulated time displayed on task cards
- Recent time entries shown
- Persistent storage using localStorage

## Components

- `TimeDisplay`: Formats seconds into HH:MM:SS or MM:SS
- `TimerControls`: Start/pause/stop buttons for timers
- `ManualTimeEntry`: Modal for adding manual time
- `TaskCard`: Displays task info with time tracking
- `GlobalTimerIndicator`: Shows active timer in bottom-right corner
- `TimeTrackingContext`: Manages state and actions

## Usage

1. Create a task using the form
2. Use "Start" to begin timing work on a task
3. Use "Pause" to temporarily stop timing
4. Use "Stop" to end the current session
5. Use "Add Time" to manually log time
6. View accumulated time and recent entries on task cards

## State Management

Uses React Context with useReducer for predictable state updates:
- Tasks with time entries
- Active timer state
- Time entry history

## Validation

- Prevents multiple active timers
- Validates manual time entries
- Ensures timer state consistency

## Persistence

Time tracking data is saved to localStorage and restored on page reload.