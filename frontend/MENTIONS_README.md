# Mentions and Inline Entity Suggestions

This feature adds rich mention functionality to text inputs throughout SoroTask, allowing users to easily reference users, tasks, and contracts while typing.

## Features

### Trigger Detection
- `@` - Mention users (e.g., `@Alice Johnson`)
- `#` - Reference tasks (e.g., `#Harvest Task`)
- `$` - Reference contracts (e.g., `$Yield Contract`)

### Smart Suggestions
- Asynchronous search with loading states
- Keyboard navigation (↑/↓ arrows, Enter/Tab to select, Escape to close)
- Mouse interaction support
- Positioned popover that follows cursor
- Error handling for failed searches

### Rich Rendering
- Visual distinction for mentions in read-only mode
- Avatar/initials display for users
- Icons for different entity types
- Hover tooltips with entity information

## Components

### MentionsInput
Main component that wraps textarea with mention functionality:
- Detects trigger characters
- Shows suggestions popover
- Handles keyboard/mouse interaction
- Inserts selected mentions

### SuggestionsPopover
Dropdown component for entity suggestions:
- Positioned relative to cursor
- Loading and error states
- Keyboard navigation support
- Click-outside to close

### MentionRenderer
Read-only component for displaying text with rendered mentions:
- Parses mention syntax
- Renders mentions as styled chips
- Supports mixed text and mentions

### MentionsContext
Provides mention configuration and search functionality:
- Configurable triggers
- Async search functions
- Mock data for demonstration

## Usage

```tsx
import { MentionsInput } from './components/MentionsInput';

// Basic usage
<MentionsInput
  value={text}
  onChange={setText}
  placeholder="Mention @users, #tasks, or $contracts"
/>

// Read-only rendering
import { MentionRenderer } from './components/MentionRenderer';

<MentionRenderer text="Check with @Alice about #Harvest Task" />
```

## Keyboard Shortcuts

- `↑/↓` - Navigate suggestions
- `Enter/Tab` - Select highlighted suggestion
- `Escape` - Close suggestions

## Technical Details

### Trigger Detection
- Triggers must be preceded by whitespace or start of line
- Query extraction stops at next whitespace
- Position calculation for popover placement

### Search API
- Async functions return `MentionableEntity[]`
- Graceful error handling
- Loading states prevent UI blocking

### Entity Types
```typescript
interface MentionableEntity {
  id: string;
  type: 'user' | 'task' | 'contract';
  displayName: string;
  avatar?: string;
  metadata?: Record<string, any>;
}
```

### Styling
- Tailwind CSS classes
- Consistent with app theme
- Accessible focus states
- Responsive design

## Error Handling

- Network failures show error messages
- Invalid searches return empty results
- Component gracefully degrades without mentions context
- Loading states prevent user confusion

## Future Enhancements

- Real API integration
- Custom triggers configuration
- Mention notifications
- Advanced parsing with IDs
- Rich text editor integration