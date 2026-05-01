# Split-Pane Integration Guide

Quick guide to integrate the split-pane task detail view into your existing pages.

## Step 1: Wrap Your Page

Wrap your existing list or board view with `SplitPaneLayout`:

```tsx
// app/tasks/page.tsx or app/board/page.tsx
import SplitPaneLayout from "@/src/components/layout/SplitPaneLayout";

export default function YourPage() {
  return (
    <SplitPaneLayout>
      {/* Your existing content stays exactly the same */}
      <YourExistingListOrBoardComponent />
    </SplitPaneLayout>
  );
}
```

## Step 2: Make Task Cards Clickable

Update your task cards to use the selection hook:

```tsx
import { useTaskSelection } from "@/src/hooks/useTaskSelection";

function YourTaskCard({ task }) {
  const { isTaskSelected, selectTask } = useTaskSelection();
  const isSelected = isTaskSelected(task.id);

  return (
    <div
      onClick={() => selectTask(task.id)}
      className={isSelected ? "border-primary-500 ring-2 ring-primary-500/50" : ""}
      data-task-id={task.id}
    >
      {/* Your existing card content */}
    </div>
  );
}
```

Or use the pre-built components:
- `TaskCardWithSelection` for list views
- `board/TaskCardWithSelection` for board views

## Step 3: Preserve Scroll Position (Optional)

If you want to preserve scroll position across pane open/close:

```tsx
import { useLayoutStore } from "@/src/store/layoutStore";
import { useEffect, useRef } from "react";

function YourListView() {
  const { listScrollPosition, saveListScrollPosition } = useLayoutStore();
  const listRef = useRef<HTMLDivElement>(null);

  // Restore on mount
  useEffect(() => {
    if (listRef.current && listScrollPosition > 0) {
      listRef.current.scrollTop = listScrollPosition;
    }
  }, [listScrollPosition]);

  // Save on scroll
  const handleScroll = () => {
    if (listRef.current) {
      saveListScrollPosition(listRef.current.scrollTop);
    }
  };

  return (
    <div ref={listRef} onScroll={handleScroll} className="overflow-y-auto">
      {/* Your list content */}
    </div>
  );
}
```

## That's It!

The split-pane layout will automatically:
- ✅ Update the URL with `?selected=task-id`
- ✅ Handle responsive breakpoints (desktop/tablet/mobile)
- ✅ Provide resize handle on desktop
- ✅ Support keyboard navigation (Escape to close)
- ✅ Manage focus properly
- ✅ Persist pane width to localStorage
- ✅ Handle invalid task IDs gracefully

## Example Pages

See the complete examples in:
- `app/tasks/page.tsx` - List view with split-pane
- `app/board/page.tsx` - Board view with split-pane

## Customizing the Detail Pane

To customize what's shown in the detail pane, edit:
- `src/components/layout/TaskDetailPane.tsx`

The component receives `taskId` and fetches its own data using `useTask(taskId)`.
