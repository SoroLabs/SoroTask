import { getDefaultDateConfig, formatDateForDisplay, isAmbiguousDate, getConfidenceLevel } from './dateConfig';

// Mock chrono-node for testing
const mockChrono = {
  parseDate: (text: string, ref?: Date): Date | null => {
    const now = ref || new Date();
    const lowerText = text.toLowerCase().trim();
    
    // Handle common natural language date expressions
    if (lowerText === 'tomorrow' || lowerText === 'tmrw') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    
    if (lowerText === 'today') {
      return now;
    }
    
    if (lowerText === 'yesterday' || lowerText === 'yst') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday;
    }
    
    // Handle "in X days"
    const inDaysMatch = lowerText.match(/in (\d+) days?/);
    if (inDaysMatch) {
      const days = parseInt(inDaysMatch[1]);
      const future = new Date(now);
      future.setDate(future.getDate() + days);
      return future;
    }
    
    // Handle "X days from now"
    const daysFromMatch = lowerText.match(/(\d+) days? from now/);
    if (daysFromMatch) {
      const days = parseInt(daysFromMatch[1]);
      const future = new Date(now);
      future.setDate(future.getDate() + days);
      return future;
    }
    
    // Handle "next [day]"
    const nextDayMatch = lowerText.match(/next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (nextDayMatch) {
      const dayName = nextDayMatch[1];
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = daysOfWeek.indexOf(dayName);
      const currentDay = now.getDay();
      const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7; // If today, go to next week
      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + daysUntilTarget);
      return nextDate;
    }
    
    // Handle "this [day]"
    const thisDayMatch = lowerText.match(/this (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (thisDayMatch) {
      const dayName = thisDayMatch[1];
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = daysOfWeek.indexOf(dayName);
      const currentDay = now.getDay();
      const daysUntilTarget = (targetDay - currentDay + 7) % 7;
      const thisDate = new Date(now);
      thisDate.setDate(thisDate.getDate() + daysUntilTarget);
      return thisDate;
    }
    
    // Handle date formats like MM/DD, MM/DD/YYYY
    const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1]) - 1;
      const day = parseInt(dateMatch[2]);
      const year = dateMatch[3] ? parseInt(dateMatch[3]) : now.getFullYear();
      const date = new Date(year, month, day);
      return date;
    }
    
    return null;
  }
};

// Test cases for natural language date parsing
const testCases = [
  // Basic relative dates
  { input: 'today', expectedConfidence: 'high', expectedAmbiguous: false },
  { input: 'tomorrow', expectedConfidence: 'high', expectedAmbiguous: false },
  { input: 'yesterday', expectedConfidence: 'high', expectedAmbiguous: false },
  
  // Relative days with numbers
  { input: 'in 3 days', expectedConfidence: 'medium', expectedAmbiguous: true },
  { input: 'in 1 day', expectedConfidence: 'medium', expectedAmbiguous: true },
  { input: '5 days from now', expectedConfidence: 'medium', expectedAmbiguous: true },
  
  // Day of week expressions
  { input: 'next Monday', expectedConfidence: 'medium', expectedAmbiguous: true },
  { input: 'next Friday', expectedConfidence: 'medium', expectedAmbiguous: true },
  { input: 'this Tuesday', expectedConfidence: 'medium', expectedAmbiguous: true },
  
  // Specific dates
  { input: '12/25', expectedConfidence: 'high', expectedAmbiguous: false },
  { input: '1/1/2024', expectedConfidence: 'high', expectedAmbiguous: false },
  { input: '02/14', expectedConfidence: 'high', expectedAmbiguous: false },
  
  // Edge cases
  { input: '', expectedConfidence: 'low', expectedAmbiguous: false },
  { input: 'invalid date', expectedConfidence: 'low', expectedAmbiguous: true },
  { input: 'maybe next week', expectedConfidence: 'low', expectedAmbiguous: true }
];

// Run tests
export const runDateParserTests = () => {
  const config = getDefaultDateConfig();
  const results = {
    passed: 0,
    failed: 0,
    failures: [] as string[]
  };

  console.log('🧪 Running Natural Language Date Parser Tests...\n');

  testCases.forEach((testCase, index) => {
    const { input, expectedConfidence, expectedAmbiguous } = testCase;
    
    // Parse the date
    const parsedDate = mockChrono.parseDate(input, config.referenceDate);
    
    // Check confidence level
    const confidence = getConfidenceLevel(input, parsedDate, config);
    
    // Check ambiguity
    const isAmbiguous = parsedDate ? isAmbiguousDate(input, parsedDate, config) : false;
    
    // Validate results
    const confidenceMatch = confidence === expectedConfidence;
    const ambiguityMatch = isAmbiguous === expectedAmbiguous;
    
    const testPassed = confidenceMatch && ambiguityMatch;
    
    if (testPassed) {
      results.passed++;
      console.log(`✅ Test ${index + 1}: "${input}" - PASSED`);
      console.log(`   Parsed: ${parsedDate ? formatDateForDisplay(parsedDate, config) : 'null'}`);
      console.log(`   Confidence: ${confidence}, Ambiguous: ${isAmbiguous}\n`);
    } else {
      results.failed++;
      const failure = `Test ${index + 1}: "${input}" - FAILED`;
      results.failures.push(failure);
      console.log(`❌ ${failure}`);
      console.log(`   Expected confidence: ${expectedConfidence}, got: ${confidence}`);
      console.log(`   Expected ambiguous: ${expectedAmbiguous}, got: ${isAmbiguous}`);
      console.log(`   Parsed: ${parsedDate ? formatDateForDisplay(parsedDate, config) : 'null'}\n`);
    }
  });

  // Summary
  console.log('📊 Test Summary:');
  console.log(`   Total tests: ${testCases.length}`);
  console.log(`   Passed: ${results.passed}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Success rate: ${((results.passed / testCases.length) * 100).toFixed(1)}%`);

  if (results.failed > 0) {
    console.log('\n❌ Failed tests:');
    results.failures.forEach(failure => console.log(`   - ${failure}`));
  }

  return results;
};

// Test specific date phrases
export const testSpecificPhrases = () => {
  const config = getDefaultDateConfig();
  const testDate = new Date('2024-04-26'); // Friday for testing
  
  const phrases = [
    'tomorrow',
    'next Monday',
    'in 3 days',
    'this Friday',
    '12/25',
    'invalid input'
  ];

  console.log('\n🔍 Testing Specific Date Phrases:');
  console.log(`Reference date: ${formatDateForDisplay(testDate, config)}\n`);

  phrases.forEach(phrase => {
    const parsed = mockChrono.parseDate(phrase, testDate);
    const confidence = getConfidenceLevel(phrase, parsed, config);
    const ambiguous = parsed ? isAmbiguousDate(phrase, parsed, config) : false;
    
    console.log(`"${phrase}"`);
    console.log(`  → ${parsed ? formatDateForDisplay(parsed, config) : 'Failed to parse'}`);
    console.log(`  Confidence: ${confidence}, Ambiguous: ${ambiguous}\n`);
  });
};
