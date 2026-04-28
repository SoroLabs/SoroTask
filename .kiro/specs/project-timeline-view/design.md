# Design Document: Project Timeline View

## Overview

The Project Timeline View is a high-performance Gantt chart visualization component for the SoroTask automation task management system. This feature enables users to visualize task schedules, dependencies, and project timelines with support for large datasets (200+ tasks) while maintaining smooth 60fps interactions.

The design prioritizes performance through virtualization, efficient rendering strategies, and optimized data transformation. The component is built as a standalone, reusable module that integrates seamlessly with the existing Next.js application.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Timeline View Page                       │
│  (Next.js Route: /app/timeline/page.tsx)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              TimelineView Component                          │
│  - Viewport management                                       │
│  - Scroll handling                                           │
│  - Zoom level state                                          │
│  - Event coordination                                        │
└────┬──────────────┬──────────────┬─────────────┬───────────┘
     │              │              │             │
     ▼              ▼              ▼             ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
│TimeGrid │  │TaskLayer │  │Dependency│  │TooltipSystem │
│Component│  │Component │  │Layer     │  │              │
└────┬────┘  └────┬─────┘  └────┬─────┘  └──────────────┘
     │            │             │
     │            ▼             │
     │      ┌──────────┐        │
     │      │TaskBar   │        │
     │      │Milestone │        │
     │      └──────────┘        │
     │                          │
     └──────────┬───────────────┘
                ▼
      ┌──────────────────┐
      │ Timeline Adapter │
      │ - Date conversion│
      │ - Data transform │
      │ - Calculations   │
      └──────────────────┘
```

### Library Selection Decision

**Selected Approach: Custom Canvas + CSS Grid Hybrid**

After evaluating vis-timeline, frappe-gantt, and custom implementations, we select a hybrid approach:

**Rationale:**
1. **Performance Requirements**: Neither vis-timeline nor frappe-gantt provides sufficient control over virtualization for 200+ tasks at 60fps
2. **Canvas for Task Rendering**: HTML Canvas API for task bars, milestones, and dependency lines provides optimal rendering performance
3. **CSS Grid for Structure**: CSS Grid for timeline structure, headers, and row layout provides maintainability and accessibility
4. **Bundle Size**: Custom implementation avoids 50-100KB library overhead
5. **Flexibility**: Full control over rendering pipeline enables precise performance optimization

**Performance Justification:**
- Canvas rendering: ~0.1ms per task bar (200 tasks = 20ms, well under 16ms budget with virtualization)
- Virtualization reduces rendered tasks to ~30-50 visible items
- CSS Grid layout: GPU-accelerated, minimal CPU overhead
- Expected frame budget: 8-12ms for full render cycle (60fps = 16.67ms budget)

### Rendering Strategy

**Hybrid Rendering Pipeline:**

1. **CSS Grid Layer** (Static Structure)
   - Timeline header with date labels
   - Row structure for task lanes
   - Scrollable container management

2. **Canvas Layer** (Dynamic Content)
   - Time grid lines (vertical day/week/month markers)
   - Task bars and milestones
   - Dependency lines with arrows
   - Hover highlights

3. **HTML Overlay Layer** (Interactive Elements)
   - Tooltips (positioned absolutely)
   - Interactive controls (zoom buttons)
   - Accessibility labels

**Rendering Order:**
```
Frame Render Cycle (target: <16ms)
├─ 1. Update viewport bounds (1ms)
├─ 2. Calculate visible tasks (2ms)
├─ 3. Clear canvas regions (1ms)
├─ 4. Draw time grid (2ms)
├─ 5. Draw task bars (4-6ms)
├─ 6. Draw dependencies (2-3ms)
└─ 7. Update HTML overlays (1ms)
```

## Components and Interfaces

### 1. TimelineView Component

**Primary container component managing state and coordination.**

```typescript
interface TimelineViewProps {
  tasks: TaskObject[];
  initialZoomLevel?: ZoomLevel;
  initialViewport?: ViewportConfig;
  projectStartDate: Date;
  projectEndDate: Date;
  onTaskClick?: (taskId: string) => void;
  workingHours?: WorkingHoursConfig;
}

interface ViewportConfig {
  startDate: Date;
  endDate: Date;
  scrollTop: number;
}

interface WorkingHoursConfig {
  startHour: number; // 0-23
  endHour: number;   // 0-23
  workingDays: number[]; // 0-6 (Sunday-Saturday)
}

type ZoomLevel = 'day' | 'week' | 'month';
```

**State Management:**
```typescript
interface TimelineState {
  viewport: ViewportConfig;
  zoomLevel: ZoomLevel;
  hoveredTaskId: string | null;
  visibleTaskIds: Set<string>;
  canvasContext: CanvasRenderingContext2D | null;
}
```

**Key Responsibilities:**
- Manage viewport state (scroll position, visible date range)
- Handle zoom level changes and recalculations
- Coordinate between sub-components
- Manage canvas context and rendering lifecycle
- Handle user interactions (scroll, hover, click)

### 2. TimelineAdapter Module

**Data transformation and calculation utilities.**

```typescript
interface TaskObject {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  owner: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  dependencies: string[]; // Array of task IDs
  isMilestone: boolean;
}

interface TimelineTask {
  id: string;
  title: string;
  x: number;          // Date offset in pixels
  y: number;          // Row position in pixels
  width: number;      // Duration in pixels
  height: number;     // Bar height (constant: 32px)
  startDate: Date;
  endDate: Date;
  owner: string;
  status: string;
  isMilestone: boolean;
  dependencies: string[];
}

interface ConversionConfig {
  projectStartDate: Date;
  zoomLevel: ZoomLevel;
  pixelsPerDay: number;
  workingHours: WorkingHoursConfig;
  timeZone: string;
}
```

**Core Functions:**

```typescript
// Date to pixel conversion
function dateToPixels(
  date: Date,
  config: ConversionConfig
): number;

// Pixel to date conversion (for interactions)
function pixelsToDate(
  pixels: number,
  config: ConversionConfig
): Date;

// Transform task array to timeline format
function transformTasks(
  tasks: TaskObject[],
  config: ConversionConfig
): TimelineTask[];

// Calculate task duration in working days
function calculateWorkingDuration(
  startDate: Date,
  endDate: Date,
  workingHours: WorkingHoursConfig
): number;

// Normalize date to project timezone
function normalizeToTimezone(
  date: Date,
  timeZone: string
): Date;
```

**Zoom Level Pixel Scaling:**
```typescript
const PIXELS_PER_DAY: Record<ZoomLevel, number> = {
  day: 40,    // 1 day = 40px (detailed view)
  week: 8,    // 1 day = 8px (weekly overview)
  month: 2    // 1 day = 2px (monthly overview)
};
```

### 3. TimeGrid Component

**Renders the background time grid.**

```typescript
interface TimeGridProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  viewport: ViewportConfig;
  zoomLevel: ZoomLevel;
  projectStartDate: Date;
  pixelsPerDay: number;
}
```

**Rendering Logic:**
- Calculate visible date range from viewport
- Determine grid division based on zoom level:
  - Day view: Draw lines every day, labels every 3 days
  - Week view: Draw lines every week, labels every week
  - Month view: Draw lines every month, labels every month
- Use `requestAnimationFrame` for smooth updates
- Cache grid calculations between frames

### 4. TaskLayer Component

**Manages virtualized task rendering.**

```typescript
interface TaskLayerProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  tasks: TimelineTask[];
  viewport: ViewportConfig;
  onTaskHover: (taskId: string | null) => void;
  onTaskClick: (taskId: string) => void;
  hoveredTaskId: string | null;
}
```

**Virtualization Algorithm:**
```typescript
function calculateVisibleTasks(
  tasks: TimelineTask[],
  viewport: ViewportConfig,
  canvasWidth: number,
  canvasHeight: number
): TimelineTask[] {
  const viewportStartX = dateToPixels(viewport.startDate, config);
  const viewportEndX = dateToPixels(viewport.endDate, config);
  const viewportStartY = viewport.scrollTop;
  const viewportEndY = viewport.scrollTop + canvasHeight;
  
  return tasks.filter(task => {
    // Horizontal culling
    const taskEndX = task.x + task.width;
    if (taskEndX < viewportStartX || task.x > viewportEndX) {
      return false;
    }
    
    // Vertical culling
    const taskEndY = task.y + task.height;
    if (taskEndY < viewportStartY || task.y > viewportEndY) {
      return false;
    }
    
    return true;
  });
}
```

**Task Bar Rendering:**
```typescript
function drawTaskBar(
  ctx: CanvasRenderingContext2D,
  task: TimelineTask,
  isHovered: boolean
): void {
  const radius = 12; // Rounded corner radius
  
  // Set colors based on status
  const colors = {
    pending: '#6B7280',
    active: '#3B82F6',
    completed: '#10B981',
    failed: '#EF4444'
  };
  
  ctx.fillStyle = colors[task.status];
  if (isHovered) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = colors[task.status];
  }
  
  // Draw rounded rectangle
  ctx.beginPath();
  ctx.roundRect(task.x, task.y, task.width, task.height, radius);
  ctx.fill();
  
  // Reset shadow
  ctx.shadowBlur = 0;
}
```

**Milestone Rendering:**
```typescript
function drawMilestone(
  ctx: CanvasRenderingContext2D,
  task: TimelineTask,
  isHovered: boolean
): void {
  const size = 16;
  const centerX = task.x;
  const centerY = task.y + task.height / 2;
  
  ctx.fillStyle = '#F59E0B'; // Amber color for milestones
  if (isHovered) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#F59E0B';
  }
  
  // Draw diamond shape
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - size);
  ctx.lineTo(centerX + size, centerY);
  ctx.lineTo(centerX, centerY + size);
  ctx.lineTo(centerX - size, centerY);
  ctx.closePath();
  ctx.fill();
  
  ctx.shadowBlur = 0;
}
```

### 5. DependencyLayer Component

**Renders dependency connections between tasks.**

```typescript
interface DependencyLayerProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  tasks: TimelineTask[];
  visibleTaskIds: Set<string>;
}

interface DependencyLine {
  fromTaskId: string;
  toTaskId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}
```

**Dependency Calculation:**
```typescript
function calculateDependencies(
  tasks: TimelineTask[],
  visibleTaskIds: Set<string>
): DependencyLine[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const dependencies: DependencyLine[] = [];
  
  for (const task of tasks) {
    if (!visibleTaskIds.has(task.id)) continue;
    
    for (const depId of task.dependencies) {
      const depTask = taskMap.get(depId);
      if (!depTask) continue;
      
      // Only render if at least one endpoint is visible
      if (!visibleTaskIds.has(depId) && !visibleTaskIds.has(task.id)) {
        continue;
      }
      
      dependencies.push({
        fromTaskId: depId,
        toTaskId: task.id,
        fromX: depTask.x + depTask.width,
        fromY: depTask.y + depTask.height / 2,
        toX: task.x,
        toY: task.y + task.height / 2
      });
    }
  }
  
  return dependencies;
}
```

**Dependency Line Rendering:**
```typescript
function drawDependencyLine(
  ctx: CanvasRenderingContext2D,
  dep: DependencyLine
): void {
  ctx.strokeStyle = '#6B7280';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]); // Dashed line
  
  // Draw S-curve connection
  ctx.beginPath();
  ctx.moveTo(dep.fromX, dep.fromY);
  
  const midX = (dep.fromX + dep.toX) / 2;
  ctx.bezierCurveTo(
    midX, dep.fromY,
    midX, dep.toY,
    dep.toX, dep.toY
  );
  ctx.stroke();
  
  // Draw arrow head
  drawArrowHead(ctx, dep.toX, dep.toY, Math.PI);
  
  ctx.setLineDash([]); // Reset dash
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number
): void {
  const size = 8;
  ctx.fillStyle = '#6B7280';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - size * Math.cos(angle - Math.PI / 6),
    y - size * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x - size * Math.cos(angle + Math.PI / 6),
    y - size * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}
```

### 6. TooltipSystem Component

**Displays task details on hover.**

```typescript
interface TooltipSystemProps {
  hoveredTaskId: string | null;
  tasks: TimelineTask[];
  mousePosition: { x: number; y: number };
}

interface TooltipData {
  title: string;
  startDate: string;
  endDate: string;
  owner: string;
  status: string;
  duration: string;
}
```

**Tooltip Positioning:**
```typescript
function calculateTooltipPosition(
  mouseX: number,
  mouseY: number,
  tooltipWidth: number,
  tooltipHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  let x = mouseX + 12; // Offset from cursor
  let y = mouseY + 12;
  
  // Prevent overflow right
  if (x + tooltipWidth > viewportWidth) {
    x = mouseX - tooltipWidth - 12;
  }
  
  // Prevent overflow bottom
  if (y + tooltipHeight > viewportHeight) {
    y = mouseY - tooltipHeight - 12;
  }
  
  return { x, y };
}
```

**Tooltip Component:**
```typescript
function Tooltip({ data, position }: TooltipProps) {
  return (
    <div
      className="absolute z-50 bg-neutral-800 border border-neutral-700 rounded-lg p-3 shadow-xl pointer-events-none"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transition: 'opacity 200ms ease-in-out'
      }}
    >
      <div className="text-sm font-medium text-neutral-100 mb-2">
        {data.title}
      </div>
      <div className="space-y-1 text-xs text-neutral-400">
        <div>Start: {data.startDate}</div>
        <div>End: {data.endDate}</div>
        <div>Owner: {data.owner}</div>
        <div>Duration: {data.duration}</div>
        <div>
          <span className={`inline-block px-2 py-0.5 rounded text-xs ${getStatusColor(data.status)}`}>
            {data.status}
          </span>
        </div>
      </div>
    </div>
  );
}
```

## Data Models

### Core Data Structures

```typescript
// Input task format (from API/state)
interface TaskObject {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  owner: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  dependencies: string[];
  isMilestone: boolean;
}

// Transformed timeline task (for rendering)
interface TimelineTask {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  startDate: Date;
  endDate: Date;
  owner: string;
  status: string;
  isMilestone: boolean;
  dependencies: string[];
}

// Viewport state
interface Viewport {
  startDate: Date;
  endDate: Date;
  scrollTop: number;
  scrollLeft: number;
  width: number;
  height: number;
}

// Conversion configuration
interface ConversionConfig {
  projectStartDate: Date;
  projectEndDate: Date;
  zoomLevel: ZoomLevel;
  pixelsPerDay: number;
  workingHours: WorkingHoursConfig;
  timeZone: string;
  rowHeight: number;
  taskHeight: number;
}
```

### Date-to-Pixel Conversion Algorithm

**Core Algorithm:**

```typescript
function dateToPixels(
  date: Date,
  config: ConversionConfig
): number {
  // Normalize both dates to project timezone
  const normalizedDate = normalizeToTimezone(date, config.timeZone);
  const normalizedStart = normalizeToTimezone(
    config.projectStartDate,
    config.timeZone
  );
  
  // Calculate working days between dates
  const workingDays = calculateWorkingDays(
    normalizedStart,
    normalizedDate,
    config.workingHours
  );
  
  // Convert to pixels based on zoom level
  const pixels = workingDays * config.pixelsPerDay;
  
  // Round to nearest pixel for accuracy
  return Math.round(pixels);
}

function calculateWorkingDays(
  startDate: Date,
  endDate: Date,
  workingHours: WorkingHoursConfig
): number {
  let workingDays = 0;
  const current = new Date(startDate);
  
  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    
    // Check if it's a working day
    if (workingHours.workingDays.includes(dayOfWeek)) {
      workingDays += 1;
    }
    
    current.setDate(current.getDate() + 1);
  }
  
  return workingDays;
}

function normalizeToTimezone(date: Date, timeZone: string): Date {
  // Use Intl.DateTimeFormat for timezone conversion
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};
  parts.forEach(part => {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  });
  
  return new Date(
    `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`
  );
}
```

**Inverse Conversion (Pixels to Date):**

```typescript
function pixelsToDate(
  pixels: number,
  config: ConversionConfig
): Date {
  // Calculate working days from pixels
  const workingDays = pixels / config.pixelsPerDay;
  
  // Add working days to project start
  const result = new Date(config.projectStartDate);
  let daysAdded = 0;
  let workingDaysAdded = 0;
  
  while (workingDaysAdded < workingDays) {
    result.setDate(result.getDate() + 1);
    daysAdded++;
    
    const dayOfWeek = result.getDay();
    if (config.workingHours.workingDays.includes(dayOfWeek)) {
      workingDaysAdded++;
    }
  }
  
  return normalizeToTimezone(result, config.timeZone);
}
```

**Accuracy Guarantee:**
- Rounding to nearest pixel ensures ±1px accuracy
- Working days calculation accounts for weekends/holidays
- Timezone normalization prevents DST issues
- Round-trip conversion maintains ±1 minute accuracy

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: 60fps Performance with Large Datasets

*For any* task set containing 200 or more tasks, all user interactions (scrolling, zooming, hovering) should maintain a frame rate of at least 60fps (frame time ≤ 16.67ms).

**Validates: Requirements 1.3, 2.4, 7.3, 12.1**

### Property 2: Virtualization Activates for Large Task Sets

*For any* project with more than 50 tasks, the Timeline_View should implement virtualization such that the number of rendered tasks is less than the total number of tasks.

**Validates: Requirements 2.1**

### Property 3: Viewport-Based Task Rendering

*For any* viewport configuration and task set, only tasks that intersect the viewport bounds (both horizontally and vertically) should be included in the rendered task set.

**Validates: Requirements 2.2, 8.3**

### Property 4: Scroll Update Performance

*For any* scroll event (horizontal or vertical), the Timeline_View should update the rendered task set within 16ms.

**Validates: Requirements 2.3**

### Property 5: Task Transformation Completeness

*For any* valid Task_Object, the Timeline_Adapter transformation should produce a TimelineTask with all required properties (id, x, y, width, height, dates, owner, status, dependencies).

**Validates: Requirements 3.1**

### Property 6: Task Transformation Correctness

*For any* valid Task_Object and conversion configuration, the transformed TimelineTask should have:
- x position equal to working days between project start and task start, multiplied by pixels-per-day
- width equal to working days between task start and task end, multiplied by pixels-per-day
- All dates normalized to the project timezone
- Working days calculated excluding non-working days per the working hours configuration

**Validates: Requirements 3.2, 3.3, 3.4, 3.5**

### Property 7: Time Grid Zoom Consistency

*For any* zoom level (day, week, month), the Time_Grid should display divisions appropriate to that zoom level, and changing the zoom level should update the grid divisions to match.

**Validates: Requirements 4.2, 4.3, 9.3**

### Property 8: Grid and Task Alignment

*For any* date D and task starting at date D, the Time_Grid line at date D should align with the x position of the task bar (within 1px tolerance).

**Validates: Requirements 4.4**

### Property 9: Task Bar Color Contrast

*For any* task status, the task bar color should have a contrast ratio of at least 4.5:1 against the background color (WCAG AA standard).

**Validates: Requirements 5.3**

### Property 10: Dependency Line Rendering

*For any* task with dependencies, there should be a dependency line rendered from each dependency task to the dependent task.

**Validates: Requirements 6.1**

### Property 11: Horizontal Scroll Updates Viewport

*For any* horizontal scroll event, the viewport start and end dates should update to reflect the new visible time range based on the scroll position.

**Validates: Requirements 7.2**

### Property 12: Vertical Scroll Updates Task Set

*For any* vertical scroll event, the set of rendered tasks should update to include only tasks visible in the new vertical viewport position.

**Validates: Requirements 8.2**

### Property 13: Zoom Recalculation

*For any* zoom level change, all task x positions and widths should be recalculated using the new pixels-per-day value for the target zoom level.

**Validates: Requirements 9.2**

### Property 14: Zoom Transition Performance

*For any* zoom level change, the transition (recalculation and re-render) should complete within 300ms.

**Validates: Requirements 9.4**

### Property 15: Tooltip Display on Hover

*For any* task bar, hovering over it should display a tooltip containing the task's dates, owner, and status within 200ms.

**Validates: Requirements 10.1, 10.2, 10.3**

### Property 16: Tooltip Hide on Unhover

*For any* displayed tooltip, moving the cursor away from the task bar should hide the tooltip within 100ms.

**Validates: Requirements 10.4**

### Property 17: Date-to-Pixel Round Trip

*For any* valid date within the project timeline, converting the date to pixels and then converting those pixels back to a date should produce a date within 1 minute of the original date.

**Validates: Requirements 11.1, 11.2, 11.3, 11.4**

### Property 18: Navigation State Preservation

*For any* global application state, navigating to the Timeline_View and then navigating away should leave the global state unchanged.

**Validates: Requirements 13.2**


## Error Handling

### Input Validation

**Invalid Task Data:**
```typescript
function validateTaskObject(task: unknown): TaskObject {
  if (!task || typeof task !== 'object') {
    throw new Error('Task must be an object');
  }
  
  const t = task as Partial<TaskObject>;
  
  if (!t.id || typeof t.id !== 'string') {
    throw new Error('Task must have a valid id');
  }
  
  if (!(t.startDate instanceof Date) || isNaN(t.startDate.getTime())) {
    throw new Error(`Task ${t.id}: startDate must be a valid Date`);
  }
  
  if (!(t.endDate instanceof Date) || isNaN(t.endDate.getTime())) {
    throw new Error(`Task ${t.id}: endDate must be a valid Date`);
  }
  
  if (t.startDate > t.endDate) {
    throw new Error(`Task ${t.id}: startDate must be before endDate`);
  }
  
  if (!Array.isArray(t.dependencies)) {
    throw new Error(`Task ${t.id}: dependencies must be an array`);
  }
  
  return t as TaskObject;
}
```

**Date Range Validation:**
```typescript
function validateDateRange(
  projectStart: Date,
  projectEnd: Date,
  task: TaskObject
): void {
  if (task.startDate < projectStart) {
    console.warn(
      `Task ${task.id} starts before project start. Clamping to project start.`
    );
  }
  
  if (task.endDate > projectEnd) {
    console.warn(
      `Task ${task.id} ends after project end. Clamping to project end.`
    );
  }
}
```

### Canvas Rendering Errors

**Canvas Context Failure:**
```typescript
function getCanvasContext(
  canvas: HTMLCanvasElement
): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error(
      'Failed to get 2D canvas context. Canvas rendering is not supported.'
    );
  }
  
  return ctx;
}
```

**Rendering Error Recovery:**
```typescript
function safeRender(
  renderFn: () => void,
  errorCallback?: (error: Error) => void
): void {
  try {
    renderFn();
  } catch (error) {
    console.error('Rendering error:', error);
    
    if (errorCallback) {
      errorCallback(error as Error);
    }
    
    // Attempt to clear canvas and show error state
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#EF4444';
      ctx.font = '14px sans-serif';
      ctx.fillText('Rendering error occurred', 20, 20);
    } catch {
      // If even error display fails, fail silently
    }
  }
}
```

### Performance Degradation

**Frame Rate Monitoring:**
```typescript
class PerformanceMonitor {
  private frameTimes: number[] = [];
  private lastFrameTime: number = 0;
  
  recordFrame(): void {
    const now = performance.now();
    
    if (this.lastFrameTime > 0) {
      const frameTime = now - this.lastFrameTime;
      this.frameTimes.push(frameTime);
      
      // Keep only last 60 frames
      if (this.frameTimes.length > 60) {
        this.frameTimes.shift();
      }
      
      // Check for performance degradation
      const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      
      if (avgFrameTime > 16.67) {
        console.warn(
          `Performance degradation detected: ${avgFrameTime.toFixed(2)}ms avg frame time`
        );
      }
    }
    
    this.lastFrameTime = now;
  }
  
  getAverageFPS(): number {
    if (this.frameTimes.length === 0) return 60;
    
    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return 1000 / avgFrameTime;
  }
}
```

### Dependency Resolution Errors

**Circular Dependency Detection:**
```typescript
function detectCircularDependencies(tasks: TaskObject[]): string[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const errors: string[] = [];
  
  function hasCycle(
    taskId: string,
    visited: Set<string>,
    recursionStack: Set<string>
  ): boolean {
    visited.add(taskId);
    recursionStack.add(taskId);
    
    const task = taskMap.get(taskId);
    if (!task) return false;
    
    for (const depId of task.dependencies) {
      if (!visited.has(depId)) {
        if (hasCycle(depId, visited, recursionStack)) {
          return true;
        }
      } else if (recursionStack.has(depId)) {
        errors.push(
          `Circular dependency detected: ${taskId} -> ${depId}`
        );
        return true;
      }
    }
    
    recursionStack.delete(taskId);
    return false;
  }
  
  const visited = new Set<string>();
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      hasCycle(task.id, visited, new Set());
    }
  }
  
  return errors;
}
```

**Missing Dependency Handling:**
```typescript
function validateDependencies(tasks: TaskObject[]): void {
  const taskIds = new Set(tasks.map(t => t.id));
  
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (!taskIds.has(depId)) {
        console.warn(
          `Task ${task.id} references missing dependency: ${depId}`
        );
      }
    }
  }
}
```

### Graceful Degradation

**Fallback for Large Datasets:**
```typescript
function shouldEnableVirtualization(taskCount: number): boolean {
  return taskCount > 50;
}

function shouldLimitRendering(taskCount: number): boolean {
  // If dataset is extremely large, limit even with virtualization
  return taskCount > 1000;
}

function getMaxRenderableTasks(taskCount: number): number {
  if (taskCount <= 50) return taskCount;
  if (taskCount <= 1000) return Math.min(taskCount, 200);
  
  // For very large datasets, cap at 200 visible tasks
  return 200;
}
```


## Testing Strategy

### Dual Testing Approach

The testing strategy employs both unit tests and property-based tests to ensure comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, error conditions, and integration points
- **Property tests**: Verify universal properties across all inputs through randomized testing

Both approaches are complementary and necessary. Unit tests catch concrete bugs and validate specific scenarios, while property tests verify general correctness across a wide input space.

### Property-Based Testing Configuration

**Library Selection:** We will use **fast-check** for property-based testing in TypeScript/JavaScript.

```bash
npm install --save-dev fast-check
```

**Configuration:**
- Each property test runs a minimum of 100 iterations
- Each test references its corresponding design document property
- Tag format: `Feature: project-timeline-view, Property {number}: {property_text}`

**Example Property Test Structure:**

```typescript
import fc from 'fast-check';

describe('Timeline Adapter Properties', () => {
  // Feature: project-timeline-view, Property 17: Date-to-Pixel Round Trip
  it('should maintain date accuracy within 1 minute for round-trip conversion', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
        fc.constantFrom('day', 'week', 'month'),
        (date, zoomLevel) => {
          const config: ConversionConfig = {
            projectStartDate: new Date('2024-01-01'),
            projectEndDate: new Date('2025-12-31'),
            zoomLevel: zoomLevel as ZoomLevel,
            pixelsPerDay: PIXELS_PER_DAY[zoomLevel],
            workingHours: DEFAULT_WORKING_HOURS,
            timeZone: 'UTC',
            rowHeight: 48,
            taskHeight: 32
          };
          
          const pixels = dateToPixels(date, config);
          const roundTripDate = pixelsToDate(pixels, config);
          
          const diffMs = Math.abs(date.getTime() - roundTripDate.getTime());
          const diffMinutes = diffMs / (1000 * 60);
          
          return diffMinutes <= 1;
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Unit Testing Strategy

**Test Organization:**
```
frontend/
├── __tests__/
│   ├── components/
│   │   ├── TimelineView.test.tsx
│   │   ├── TimeGrid.test.tsx
│   │   ├── TaskLayer.test.tsx
│   │   ├── DependencyLayer.test.tsx
│   │   └── TooltipSystem.test.tsx
│   ├── utils/
│   │   ├── timelineAdapter.test.ts
│   │   ├── dateConversion.test.ts
│   │   └── virtualization.test.ts
│   └── integration/
│       ├── timeline-rendering.test.tsx
│       └── timeline-interactions.test.tsx
```

**Unit Test Categories:**

1. **Component Rendering Tests**
   - Verify components render without errors
   - Check correct props are passed to children
   - Validate conditional rendering logic

2. **Data Transformation Tests**
   - Test date-to-pixel conversion with known values
   - Test working days calculation
   - Test timezone normalization
   - Test task transformation

3. **Virtualization Tests**
   - Test visible task calculation
   - Test viewport bounds checking
   - Test scroll position updates

4. **Interaction Tests**
   - Test hover events trigger tooltips
   - Test click events fire callbacks
   - Test scroll events update viewport
   - Test zoom changes recalculate layout

5. **Edge Case Tests**
   - Empty task list
   - Single task
   - Tasks with no dependencies
   - Tasks with circular dependencies (error case)
   - Tasks outside project date range
   - Milestone tasks (zero duration)
   - Same-day tasks (overlapping)

6. **Error Handling Tests**
   - Invalid task data
   - Missing canvas context
   - Invalid date ranges
   - Missing dependencies

### Property-Based Test Suite

**Property Test Coverage:**

```typescript
// Feature: project-timeline-view, Property 1: 60fps Performance with Large Datasets
describe('Performance Properties', () => {
  it('should maintain 60fps with 200+ tasks', () => {
    fc.assert(
      fc.property(
        fc.array(taskObjectArbitrary(), { minLength: 200, maxLength: 250 }),
        (tasks) => {
          const monitor = new PerformanceMonitor();
          const timeline = renderTimeline({ tasks });
          
          // Simulate 60 frames of interaction
          for (let i = 0; i < 60; i++) {
            const startTime = performance.now();
            timeline.scroll(i * 10, 0);
            const endTime = performance.now();
            
            monitor.recordFrame();
            
            // Each frame should be under 16.67ms
            expect(endTime - startTime).toBeLessThan(16.67);
          }
          
          return monitor.getAverageFPS() >= 60;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: project-timeline-view, Property 3: Viewport-Based Task Rendering
describe('Virtualization Properties', () => {
  it('should only render tasks intersecting viewport', () => {
    fc.assert(
      fc.property(
        fc.array(taskObjectArbitrary(), { minLength: 10, maxLength: 100 }),
        fc.record({
          startDate: fc.date(),
          endDate: fc.date(),
          scrollTop: fc.nat(1000),
          width: fc.integer({ min: 800, max: 1920 }),
          height: fc.integer({ min: 600, max: 1080 })
        }),
        (tasks, viewport) => {
          const config = createConfig('day');
          const timelineTasks = transformTasks(tasks, config);
          const visibleTasks = calculateVisibleTasks(
            timelineTasks,
            viewport,
            viewport.width,
            viewport.height
          );
          
          // Every visible task must intersect viewport
          return visibleTasks.every(task => {
            const viewportStartX = dateToPixels(viewport.startDate, config);
            const viewportEndX = dateToPixels(viewport.endDate, config);
            const viewportStartY = viewport.scrollTop;
            const viewportEndY = viewport.scrollTop + viewport.height;
            
            const taskEndX = task.x + task.width;
            const taskEndY = task.y + task.height;
            
            const horizontalIntersect = !(taskEndX < viewportStartX || task.x > viewportEndX);
            const verticalIntersect = !(taskEndY < viewportStartY || task.y > viewportEndY);
            
            return horizontalIntersect && verticalIntersect;
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: project-timeline-view, Property 6: Task Transformation Correctness
describe('Transformation Properties', () => {
  it('should correctly transform tasks with working days calculation', () => {
    fc.assert(
      fc.property(
        taskObjectArbitrary(),
        fc.constantFrom('day', 'week', 'month'),
        (task, zoomLevel) => {
          const config = createConfig(zoomLevel as ZoomLevel);
          const [transformed] = transformTasks([task], config);
          
          // Calculate expected values
          const expectedWorkingDays = calculateWorkingDays(
            config.projectStartDate,
            task.startDate,
            config.workingHours
          );
          const expectedX = expectedWorkingDays * config.pixelsPerDay;
          
          const durationWorkingDays = calculateWorkingDays(
            task.startDate,
            task.endDate,
            config.workingHours
          );
          const expectedWidth = durationWorkingDays * config.pixelsPerDay;
          
          // Allow 1px tolerance for rounding
          return (
            Math.abs(transformed.x - expectedX) <= 1 &&
            Math.abs(transformed.width - expectedWidth) <= 1
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: project-timeline-view, Property 9: Task Bar Color Contrast
describe('Accessibility Properties', () => {
  it('should maintain 4.5:1 contrast ratio for all task statuses', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pending', 'active', 'completed', 'failed'),
        (status) => {
          const taskColor = getTaskColor(status);
          const backgroundColor = '#171717'; // neutral-900
          
          const contrast = calculateContrastRatio(taskColor, backgroundColor);
          
          return contrast >= 4.5;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: project-timeline-view, Property 10: Dependency Line Rendering
describe('Dependency Properties', () => {
  it('should render dependency lines for all task dependencies', () => {
    fc.assert(
      fc.property(
        fc.array(taskObjectArbitrary(), { minLength: 5, maxLength: 20 }),
        (tasks) => {
          const config = createConfig('day');
          const timelineTasks = transformTasks(tasks, config);
          const taskMap = new Map(timelineTasks.map(t => [t.id, t]));
          const visibleIds = new Set(timelineTasks.map(t => t.id));
          
          const dependencies = calculateDependencies(timelineTasks, visibleIds);
          
          // Count expected dependencies
          let expectedCount = 0;
          for (const task of timelineTasks) {
            for (const depId of task.dependencies) {
              if (taskMap.has(depId)) {
                expectedCount++;
              }
            }
          }
          
          return dependencies.length === expectedCount;
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Custom Arbitraries for Property Tests:**

```typescript
// Generate random valid task objects
function taskObjectArbitrary(): fc.Arbitrary<TaskObject> {
  return fc.record({
    id: fc.uuid(),
    title: fc.string({ minLength: 5, maxLength: 50 }),
    startDate: fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') }),
    endDate: fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') }),
    owner: fc.emailAddress(),
    status: fc.constantFrom('pending', 'active', 'completed', 'failed'),
    dependencies: fc.array(fc.uuid(), { maxLength: 3 }),
    isMilestone: fc.boolean()
  }).map(task => ({
    ...task,
    // Ensure endDate is after startDate
    endDate: task.endDate < task.startDate ? task.startDate : task.endDate
  }));
}
```

### Performance Testing

**Performance Test Suite:**

```typescript
describe('Performance Benchmarks', () => {
  it('should render 200 tasks in under 50ms', () => {
    const tasks = generateTasks(200);
    const config = createConfig('day');
    
    const startTime = performance.now();
    const timelineTasks = transformTasks(tasks, config);
    renderTasksToCanvas(timelineTasks, canvas, config);
    const endTime = performance.now();
    
    expect(endTime - startTime).toBeLessThan(50);
  });
  
  it('should handle scroll events in under 16ms', () => {
    const tasks = generateTasks(200);
    const timeline = renderTimeline({ tasks });
    
    const scrollTimes: number[] = [];
    
    for (let i = 0; i < 100; i++) {
      const startTime = performance.now();
      timeline.scroll(i * 10, 0);
      const endTime = performance.now();
      
      scrollTimes.push(endTime - startTime);
    }
    
    const avgTime = scrollTimes.reduce((a, b) => a + b, 0) / scrollTimes.length;
    expect(avgTime).toBeLessThan(16);
  });
  
  it('should complete zoom transitions in under 300ms', () => {
    const tasks = generateTasks(200);
    const timeline = renderTimeline({ tasks, initialZoomLevel: 'day' });
    
    const startTime = performance.now();
    timeline.setZoomLevel('week');
    const endTime = performance.now();
    
    expect(endTime - startTime).toBeLessThan(300);
  });
});
```

### Integration Testing

**Integration Test Scenarios:**

1. **Full Timeline Rendering**
   - Load timeline with 100 tasks
   - Verify all components render
   - Verify task bars appear at correct positions
   - Verify dependency lines connect correct tasks

2. **User Interaction Flow**
   - Scroll horizontally through timeline
   - Scroll vertically through task list
   - Hover over tasks to show tooltips
   - Click tasks to trigger callbacks
   - Change zoom levels

3. **Navigation Integration**
   - Navigate to timeline view
   - Verify timeline loads with task data
   - Navigate away from timeline
   - Verify global state preserved
   - Navigate back to timeline
   - Verify timeline state restored

4. **Error Recovery**
   - Load timeline with invalid task data
   - Verify error handling displays appropriate message
   - Load timeline with circular dependencies
   - Verify warning displayed but rendering continues

### Test Coverage Goals

- **Unit Test Coverage**: 90%+ code coverage
- **Property Test Coverage**: All 18 correctness properties implemented
- **Integration Test Coverage**: All major user flows covered
- **Performance Test Coverage**: All performance requirements validated

### Continuous Integration

**CI Pipeline:**
```yaml
test:
  - npm run test              # Run all unit tests
  - npm run test:coverage     # Generate coverage report
  - npm run test:properties   # Run property-based tests (100 iterations)
  - npm run test:performance  # Run performance benchmarks
```

**Coverage Thresholds:**
```json
{
  "jest": {
    "coverageThreshold": {
      "global": {
        "branches": 85,
        "functions": 90,
        "lines": 90,
        "statements": 90
      }
    }
  }
}
```


## Implementation Notes

### File Structure

```
frontend/
├── app/
│   └── timeline/
│       └── page.tsx                    # Timeline route page
├── components/
│   └── timeline/
│       ├── TimelineView.tsx            # Main container component
│       ├── TimeGrid.tsx                # Time grid background
│       ├── TaskLayer.tsx               # Task rendering layer
│       ├── DependencyLayer.tsx         # Dependency lines
│       ├── TooltipSystem.tsx           # Tooltip display
│       └── types.ts                    # TypeScript interfaces
├── lib/
│   └── timeline/
│       ├── adapter.ts                  # TimelineAdapter utilities
│       ├── dateConversion.ts           # Date-to-pixel conversion
│       ├── virtualization.ts           # Viewport calculations
│       ├── constants.ts                # Constants (pixels per day, etc.)
│       └── types.ts                    # Shared types
└── __tests__/
    └── timeline/
        ├── components/                 # Component tests
        ├── utils/                      # Utility tests
        ├── properties/                 # Property-based tests
        └── integration/                # Integration tests
```

### Implementation Phases

**Phase 1: Core Data Layer (Days 1-2)**
- Implement TimelineAdapter module
- Implement date-to-pixel conversion functions
- Implement working days calculation
- Implement timezone normalization
- Write unit tests for adapter (100% coverage)
- Write property tests for date conversion

**Phase 2: Rendering Foundation (Days 3-4)**
- Implement TimelineView container component
- Implement canvas setup and context management
- Implement TimeGrid component
- Implement basic task bar rendering
- Write unit tests for rendering components

**Phase 3: Virtualization (Days 5-6)**
- Implement viewport calculation logic
- Implement visible task filtering
- Implement scroll event handling
- Optimize rendering performance
- Write property tests for virtualization

**Phase 4: Advanced Features (Days 7-8)**
- Implement DependencyLayer component
- Implement TooltipSystem component
- Implement zoom level switching
- Implement milestone rendering
- Write integration tests

**Phase 5: Performance Optimization (Days 9-10)**
- Profile rendering performance
- Optimize canvas drawing operations
- Implement requestAnimationFrame batching
- Add performance monitoring
- Run performance benchmarks

**Phase 6: Integration & Polish (Days 11-12)**
- Integrate with existing navigation
- Add loading states
- Add error boundaries
- Polish animations and transitions
- Final testing and bug fixes

### Performance Optimization Strategies

**1. Canvas Rendering Optimizations**

```typescript
// Use offscreen canvas for complex rendering
const offscreenCanvas = new OffscreenCanvas(width, height);
const offscreenCtx = offscreenCanvas.getContext('2d');

// Render to offscreen canvas
renderTasks(offscreenCtx, tasks);

// Transfer to main canvas in one operation
mainCtx.drawImage(offscreenCanvas, 0, 0);
```

**2. Batch Canvas Operations**

```typescript
// Batch similar operations to reduce state changes
function batchRenderTaskBars(
  ctx: CanvasRenderingContext2D,
  tasks: TimelineTask[]
): void {
  // Group tasks by status (color)
  const tasksByStatus = groupBy(tasks, t => t.status);
  
  // Render each group with single fillStyle set
  for (const [status, statusTasks] of Object.entries(tasksByStatus)) {
    ctx.fillStyle = getTaskColor(status);
    
    for (const task of statusTasks) {
      ctx.beginPath();
      ctx.roundRect(task.x, task.y, task.width, task.height, 12);
      ctx.fill();
    }
  }
}
```

**3. Debounce Expensive Operations**

```typescript
// Debounce zoom recalculation
const debouncedZoomChange = useMemo(
  () => debounce((newZoomLevel: ZoomLevel) => {
    setZoomLevel(newZoomLevel);
    recalculateAllTasks(newZoomLevel);
  }, 100),
  []
);
```

**4. Memoize Calculations**

```typescript
// Memoize visible task calculation
const visibleTasks = useMemo(
  () => calculateVisibleTasks(tasks, viewport, canvasWidth, canvasHeight),
  [tasks, viewport.startDate, viewport.endDate, viewport.scrollTop, canvasWidth, canvasHeight]
);
```

**5. Use Web Workers for Heavy Computation**

```typescript
// Offload task transformation to web worker
const worker = new Worker('/workers/timeline-adapter.worker.js');

worker.postMessage({
  type: 'TRANSFORM_TASKS',
  tasks,
  config
});

worker.onmessage = (event) => {
  const { timelineTasks } = event.data;
  setTransformedTasks(timelineTasks);
};
```

### Accessibility Considerations

**Keyboard Navigation:**
```typescript
function handleKeyDown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowLeft':
      scrollHorizontal(-50);
      break;
    case 'ArrowRight':
      scrollHorizontal(50);
      break;
    case 'ArrowUp':
      scrollVertical(-50);
      break;
    case 'ArrowDown':
      scrollVertical(50);
      break;
    case '+':
    case '=':
      zoomIn();
      break;
    case '-':
      zoomOut();
      break;
  }
}
```

**ARIA Labels:**
```typescript
<div
  role="application"
  aria-label="Project Timeline View"
  aria-describedby="timeline-description"
>
  <div id="timeline-description" className="sr-only">
    Interactive Gantt chart showing project tasks and dependencies.
    Use arrow keys to scroll, plus and minus to zoom.
  </div>
  
  <canvas
    ref={canvasRef}
    role="img"
    aria-label={`Timeline showing ${tasks.length} tasks`}
  />
</div>
```

**Screen Reader Support:**
```typescript
// Provide text alternative for canvas content
function generateTimelineDescription(tasks: TimelineTask[]): string {
  return `Timeline contains ${tasks.length} tasks. 
    ${tasks.filter(t => t.status === 'active').length} active, 
    ${tasks.filter(t => t.status === 'completed').length} completed, 
    ${tasks.filter(t => t.status === 'pending').length} pending.`;
}
```

### Browser Compatibility

**Supported Browsers:**
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Polyfills Required:**
- None (all features use standard APIs)

**Feature Detection:**
```typescript
function checkBrowserSupport(): boolean {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    console.error('Canvas 2D context not supported');
    return false;
  }
  
  if (typeof ctx.roundRect !== 'function') {
    console.warn('roundRect not supported, using polyfill');
    polyfillRoundRect(ctx);
  }
  
  return true;
}
```

### Configuration Options

**Default Configuration:**
```typescript
export const DEFAULT_CONFIG: Partial<ConversionConfig> = {
  zoomLevel: 'week',
  pixelsPerDay: 8,
  workingHours: {
    startHour: 9,
    endHour: 17,
    workingDays: [1, 2, 3, 4, 5] // Monday-Friday
  },
  timeZone: 'UTC',
  rowHeight: 48,
  taskHeight: 32
};

export const PIXELS_PER_DAY: Record<ZoomLevel, number> = {
  day: 40,
  week: 8,
  month: 2
};

export const COLORS = {
  background: '#171717',
  gridLine: '#262626',
  gridLabel: '#737373',
  taskPending: '#6B7280',
  taskActive: '#3B82F6',
  taskCompleted: '#10B981',
  taskFailed: '#EF4444',
  milestone: '#F59E0B',
  dependency: '#6B7280',
  hover: '#FFFFFF20'
};
```

### Integration with Existing Application

**Navigation Integration:**

```typescript
// app/timeline/page.tsx
'use client';

import { TimelineView } from '@/components/timeline/TimelineView';
import { useTasks } from '@/hooks/useTasks';

export default function TimelinePage() {
  const { tasks, isLoading, error } = useTasks();
  
  if (isLoading) {
    return <LoadingSpinner />;
  }
  
  if (error) {
    return <ErrorDisplay error={error} />;
  }
  
  return (
    <div className="min-h-screen bg-neutral-900">
      <header className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
              S
            </div>
            <h1 className="text-xl font-bold tracking-tight">SoroTask Timeline</h1>
          </div>
          <nav className="flex gap-4">
            <a href="/" className="text-neutral-400 hover:text-neutral-100">
              Dashboard
            </a>
            <a href="/timeline" className="text-neutral-100">
              Timeline
            </a>
          </nav>
        </div>
      </header>
      
      <main className="container mx-auto px-6 py-8">
        <TimelineView
          tasks={tasks}
          projectStartDate={new Date('2024-01-01')}
          projectEndDate={new Date('2024-12-31')}
          initialZoomLevel="week"
          onTaskClick={(taskId) => {
            // Navigate to task detail or open modal
            console.log('Task clicked:', taskId);
          }}
        />
      </main>
    </div>
  );
}
```

**State Management:**

The Timeline component is designed to be stateless and controlled by parent components. It does not directly interact with global state management, ensuring it remains reusable and testable.

```typescript
// Parent component manages state
function TaskManagementPage() {
  const [tasks, setTasks] = useState<TaskObject[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  
  return (
    <>
      <TimelineView
        tasks={tasks}
        onTaskClick={setSelectedTaskId}
        // ... other props
      />
      
      {selectedTaskId && (
        <TaskDetailModal
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </>
  );
}
```

### Future Enhancements

**Potential Future Features:**
1. Drag-and-drop task rescheduling
2. Task creation directly in timeline
3. Dependency creation via drag-and-drop
4. Critical path highlighting
5. Resource allocation view
6. Export to PDF/PNG
7. Collaborative real-time editing
8. Custom color schemes
9. Task filtering and search
10. Baseline comparison view

**Extensibility Points:**
- Custom task renderers via render prop pattern
- Plugin system for additional layers
- Custom zoom levels
- Configurable working hours per task
- Custom dependency line styles

