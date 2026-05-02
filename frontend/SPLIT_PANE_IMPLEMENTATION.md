# Split-Pane Task Detail View Implementation

This document describes the implementation of the split-pane task detail view feature.

## Architecture Overview

The split-pane layout is implemented as a wrapper component that preserves existing list/board views without refactoring their internals.

### Core Components

1. **SplitPaneLayout** (`src/components/layout/SplitPaneLayout.tsx`)
   - Main layout wrapper that manages the split-pane UI
   - Handles responsive breakpoints (desktop/tablet/mobile)
   - Manages resize handle and drag operations
   - Syncs with URL query parameters
   - Implements keyboard navigation (Escape to close)

2. **TaskDetailPane** (`src/components/layout/TaskDetailPane.tsx`)
   - Displays task details in the right pane
   - Fetches its own data using `useTask(taskId)`
   - Handles invalid task IDs gracefully
   - Implements focus management

3. **layoutStore** (`src/store/layoutStore.ts`)
   - Zustand store for layout state persistence
   - Stores: selected task ID, pane width, scroll positions
   - Persists pane width to localStorage
   - Preserves scroll positions across pane open/close

4. **useTaskSelection** (`src/hooks/useTaskSelection.ts`)
   - Hook for managing task selection from list/board views
   - Provides consistent interface: `selectTask`, `deselectTask`, `isTaskSelected`

5. **TaskCardWithSelection** components
   - Enhanced task cards that support selection state
   - Visual "active" state when selected (border + ring)
   - Keyboard accessible (Enter/Space to select)

## Usage

### Wrapping a Page

```tsx
import SplitPaneLayout from "@/src/components/layout/SplitPaneLayout";

export default function TasksPage() {
  return (
    <SplitPaneLayout>
      {/* Your existing list/board view */}
    </SplitPaneLayout>
  );
}
```

### Making Task Cards Selectable

```tsx
import { useTaskSelection } from "@/src/hooks/useTaskSelection";

function TaskCard({ task }) {
  const { isTaskSelected, selectTask } = useTaskSelection();
  const isSelected = isTaskSelected(task.id);

  return (
    <div
      onClick={() => selectTask(task.id)}
      className={isSelected ? "border-primary-500 ring-2" : ""}
    >
      {/* Task content */}
    </div>
  );
}
```

## Responsive Behavior

### Desktop (≥ 1024px)
- Split-pane layout with draggable resize handle
- Default: 60% list / 40% detail
- Min widths: 320px list, 300px detail
- Double-click handle to reset to default
- Pane width persists to localStorage

### Tablet (768-1023px)
- Detail pane overlays as a drawer (420px wide)
- Backdrop behind drawer
- List remains mounted but non-interactive
- No resize handle

### Mobile (< 768px)
- Detail pane takes full screen
- Back button (← Back) in header
- No split or drawer

## URL State Management

The layout syncs with URL query parameters:

- Opening a task: `/tasks?selected=task-123`
- Closing: `/tasks` (param removed)
- Each selection creates a new history entry
- Back/forward navigation works intuitively
- Invalid task IDs silently close the pane

## Keyboard Navigation

- **Escape**: Close detail pane
- **Enter/Space** on task card: Open detail pane
- **Tab**: Navigate through pane elements (no focus trap)
- Focus returns to triggering element on close

## Accessibility

- Detail pane: `role="complementary"` `aria-label="Task detail"`
- Resize handle: `role="separator"` `aria-orientation="vertical"`
- Selected cards: `aria-pressed="true"`
- Drawer backdrop: `aria-hidden="true"`
- Reduced motion support: instant transitions when `prefers-reduced-motion` is enabled

## Layout Persistence

The following state persists across pane open/close and route navigations:

- List scroll position
- Board column scroll positions
- Active filters and sort order
- Pane width (localStorage)
- Selected task (URL)

## Implementation Notes

### No Remounting
The list/board view stays in the DOM when the pane opens/closes. This is achieved by:
- Using CSS transforms for animations
- Conditional rendering of the detail pane only
- Preserving scroll positions in the layout store

### Decoupled Detail Pane
The detail pane is completely decoupled from the list/board:
- Receives only `taskId` as a prop
- Fetches its own data via `useTask(taskId)`
- Handles loading and error states independently

### Native Resize Implementation
No third-party libraries for drag/resize:
- Mouse events: `onMouseDown`, `onMouseMove`, `onMouseUp`
- Calculates percentage widths based on container size
- Enforces minimum widths
- Double-click to reset

## Files Created

```
frontend/
├── src/
│   ├── components/
│   │   └── layout/
│   │       ├── SplitPaneLayout.tsx       # Main layout wrapper
│   │       └── TaskDetailPane.tsx        # Detail pane content
│   ├── hooks/
│   │   └── useTaskSelection.ts           # Selection hook
│   └── store/
│       └── layoutStore.ts                # Layout state store
├── components/
│   ├── TaskCardWithSelection.tsx         # Enhanced task card
│   └── board/
│       └── TaskCardWithSelection.tsx     # Enhanced board card
└── app/
    ├── tasks/
    │   └── page.tsx                      # Tasks page with split-pane
    └── board/
        └── page.tsx                      # Board page with split-pane
```

## Testing Checklist

- [ ] Opening a task doesn't reset list scroll position
- [ ] Switching tasks swaps content without remounting list
- [ ] URL updates with `selected=` param
- [ ] Refreshing with `selected=` reopens the pane
- [ ] Back/forward navigation works correctly
- [ ] Mobile shows full-screen sheet
- [ ] Tablet shows drawer with backdrop
- [ ] Desktop shows split-pane with resize handle
- [ ] Resize handle enforces minimum widths
- [ ] Double-click resets to 60/40
- [ ] Pane width persists after refresh
- [ ] Escape closes pane
- [ ] Focus returns to triggering element
- [ ] Invalid task ID doesn't error
- [ ] Reduced motion disables animations

## Future Enhancements

- Add keyboard shortcuts (e.g., `j`/`k` to navigate tasks)
- Support multiple detail panes (tabs)
- Add pane position preference (left/right)
- Implement pane collapse/expand animation
- Add detail pane toolbar with actions
- Support pinning the pane open
