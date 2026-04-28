# Natural Language Due Date Parser

A smart input component that converts human-friendly scheduling phrases into precise dates with live validation feedback.

## Features

- 🧠 **Natural Language Processing**: Parses common date phrases like "tomorrow", "next Friday", "in 3 days"
- ✅ **Live Validation**: Shows parsed results in real-time before submission
- 🎯 **Confidence Scoring**: Indicates parsing accuracy with high/medium/low confidence levels
- ⚠️ **Ambiguity Detection**: Warns users when input could be interpreted multiple ways
- 🌍 **Timezone Aware**: Handles different timezones and locales automatically
- 🎨 **Beautiful UI**: Integrates seamlessly with the existing SoroTask design

## Supported Expressions

### Relative Dates
- `today`, `tomorrow`, `yesterday`
- `in 3 days`, `in 1 day`
- `5 days from now`, `10 days from now`

### Day of Week
- `next Monday`, `next Friday`
- `this Tuesday`, `this Saturday`

### Specific Dates
- `12/25` (December 25th of current year)
- `1/1/2024` (January 1st, 2024)
- `02/14` (February 14th of current year)

## Component Usage

```tsx
import DateInput from './components/DateInput';

function TaskForm() {
  const [dueDate, setDueDate] = useState('');
  const [parsedDate, setParsedDate] = useState<Date | undefined>();

  const handleDateChange = (value: string, date?: Date) => {
    setDueDate(value);
    setParsedDate(date);
  };

  return (
    <DateInput
      value={dueDate}
      onChange={handleDateChange}
      label="Due Date"
      placeholder="e.g., 'tomorrow', 'next Friday', 'in 3 days'"
    />
  );
}
```

## Validation Feedback

The component provides three levels of validation feedback:

### High Confidence (Green)
- Specific dates: `12/25`, `1/1/2024`
- Common terms: `today`, `tomorrow`, `yesterday`

### Medium Confidence (Yellow)
- Relative terms: `next Monday`, `in 3 days`
- May require user verification

### Low Confidence (Red)
- Ambiguous or unrecognized input
- Shows suggestions for proper formatting

## Timezone & Locale Support

The parser automatically detects:
- User's timezone from `Intl.DateTimeFormat()`
- User's locale from `navigator.language`
- 12/24 hour format preferences

### Manual Configuration

```tsx
import { getDefaultDateConfig } from './utils/dateConfig';

const config = getDefaultDateConfig();
// Override settings if needed
config.timezone = 'America/New_York';
config.locale = 'en-US';
config.weekStartsOn = 1; // Monday
```

## Architecture

### Files Structure
```
frontend/
├── app/
│   ├── components/
│   │   └── DateInput.tsx          # Main component
│   ├── utils/
│   │   ├── dateConfig.ts          # Configuration & utilities
│   │   └── dateParser.test.ts     # Test suite
│   └── docs/
│       └── NaturalLanguageDateParser.md
```

### Key Components

1. **DateInput Component** (`DateInput.tsx`)
   - Main React component with live validation
   - Handles user input and parsing
   - Provides visual feedback

2. **Date Configuration** (`dateConfig.ts`)
   - Timezone and locale handling
   - Confidence scoring algorithms
   - Ambiguity detection logic

3. **Test Suite** (`dateParser.test.ts`)
   - Comprehensive test coverage
   - Edge case validation
   - Performance benchmarks

## Integration with SoroTask

The DateInput component has been integrated into the task creation form:

```tsx
// In page.tsx
<DateInput
  value={taskData.dueDate}
  onChange={handleDateChange}
  label="Due Date"
  required={false}
  className="mt-4"
/>
```

## Testing

Run the test suite to verify functionality:

```typescript
import { runDateParserTests, testSpecificPhrases } from './utils/dateParser.test';

// Run all tests
const results = runDateParserTests();

// Test specific phrases
testSpecificPhrases();
```

## Error Handling

### Common Issues & Solutions

1. **Unrecognized Input**
   - Shows red validation border
   - Provides format suggestions
   - Examples: "maybe next week" → Try: "next week"

2. **Ambiguous Dates**
   - Shows yellow warning indicator
   - Displays timezone information
   - Requires user confirmation

3. **Timezone Conflicts**
   - Automatically detects user timezone
   - Shows timezone in validation feedback
   - Handles DST changes automatically

## Future Enhancements

- [ ] Support for time expressions: "next Monday at 3pm"
- [ ] Recurring dates: "every Monday"
- [ ] Relative to other dates: "2 days after task completion"
- [ ] Voice input support
- [ ] Calendar integration
- [ ] Custom date formats

## Dependencies

**Production Ready:**
- `chrono-node` - Natural language date parsing library

**Development:**
- TypeScript for type safety
- React 19 for component framework
- TailwindCSS for styling

## Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Supports modern `Intl.DateTimeFormat` API for timezone detection.

---

*This component enhances the SoroTask platform by making date entry more intuitive and user-friendly while maintaining data accuracy through intelligent validation.*
