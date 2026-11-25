# Dashboard Grid System

## Overview

The SoroTask dashboard implements a customizable grid-based widget system that allows users to personalize their analytics workspace. The grid supports drag-and-drop reordering, widget visibility toggling, and persistent configuration via localStorage.

## Widget Registry API

### WidgetDefinition Type

```typescript
type WidgetStatus = "loading" | "empty" | "error" | "success";
type WidgetSize = "small" | "medium" | "large";

type WidgetDefinition = {
  id: string;              // Unique identifier for the widget
  title: string;           // Display title shown in widget header
  description: string;       // Tooltip text describing widget purpose
  defaultSize: WidgetSize; // Initial grid column span
  getStatus: () => WidgetStatus; // Function returning current widget state
  render: () => JSX.Element;     // Function rendering widget content
}
```

### WidgetGrid Props

The `WidgetGrid` component accepts the following props:

```typescript
type WidgetGridProps = {
  widgetRegistry: Record<string, WidgetDefinition>; // Map of widget definitions
  storageKey?: string;                            // Optional localStorage key (defaults to "sorotask.dashboard.config.v1")
}
```

## How to Add New Widgets

1. Create a new `WidgetDefinition` entry in your registry:

```typescript
const widgetRegistry: Record<string, WidgetDefinition> = {
  // ... existing widgets
  myNewWidget: {
    id: "myNewWidget",
    title: "My New Widget",
    description: "Description of what this widget shows.",
    defaultSize: "small",
    getStatus: () => "success", // or "loading" | "empty" | "error"
    render: () => <div>Your widget content here</div>,
  },
};
```

2. Pass the registry to `WidgetGrid`:

```tsx
<WidgetGrid widgetRegistry={widgetRegistry} />
```

3. The widget will automatically appear in:
   - The visibility toggle controls
   - The dashboard grid
   - localStorage persistence

### Widget Size Guidelines

- `small`: Single column width (default for most widgets)
- `medium`: Single column width (same as small, for semantic distinction)
- `large`: Double column width (spans both grid columns on medium screens)

## Drag-and-Drop Behavior

The dashboard implements native HTML5 drag-and-drop:

1. **Drag Start**: Widget sets `draggingId` state, applies `opacity-60` class
2. **Drag Over**: Prevents default to allow drop target behavior
3. **Drop**: Reorders widgets by swapping positions in the order array
4. **Drag End**: Clears `draggingId` state, resets opacity

### Reordering Logic

```typescript
function reorderWidgets(order: string[], fromId: string, toId: string): string[] {
  // Moves widget from position to position in order array
  // Returns new array with updated order
}
```

### Accessibility

- `aria-grabbed` attribute indicates drag state
- `aria-describedby` links widgets to their status badges
- Keyboard navigation supported via standard form controls

## Persistence Format

Configuration is stored in localStorage as JSON:

```typescript
type DashboardConfig = {
  widgetOrder: string[];      // Ordered list of widget IDs
  hiddenWidgetIds: string[];  // IDs of hidden widgets
}
```

### Storage Key

Default: `sorotask.dashboard.config.v1`

Custom key can be provided via `WidgetGrid` props for multiple dashboard instances.

### Loading Behavior

1. On mount, attempts to read from localStorage
2. If no config exists, uses default order (alphabetical by key)
3. Invalid/malformed data falls back to defaults
4. Unknown widget IDs are filtered out during load

## Status Styling

Each widget status has distinct visual styling:

| Status | Border Class | Background Class |
|--------|-------------|-----------------|
| success | `border-emerald-400/30` | `bg-emerald-500/10` |
| loading | `border-amber-400/40` | `bg-amber-500/10` |
| empty | `border-slate-500/40` | `bg-slate-500/10` |
| error | `border-rose-400/40` | `bg-rose-500/10` |

## Accessibility Notes

### Keyboard Navigation

- Tab navigates between widget visibility checkboxes
- Space/Enter toggles widget visibility
- Drag-and-drop is mouse-only; keyboard users should use visibility controls

### Screen Reader Support

- Each widget has `aria-grabbed` indicating drag availability
- Status badges are linked via `aria-describedby`
- Visibility controls have descriptive `aria-label` attributes

### Focus Management

- Checkbox inputs are native form controls
- Focus follows DOM order (respecting widget order)
- No trapped focus states

### ARIA Roles

- Widget visibility section: `role="group"` with `aria-label`
- Individual widgets: Semantic `<article>` with drag attributes
- Status badges: Description elements referenced by widgets