#!/bin/bash

# Quick Start Guide for Calendar Feature
# ======================================

# 1. Install dependencies (no additional deps needed - uses existing stack)
cd frontend
npm install

# 2. Run development server
npm run dev
# Calendar is now available at http://localhost:3000

# 3. View calendar with mock data
# The homepage displays:
# - Task Scheduling Calendar (with 5 mock tasks)
# - Calendar navigation (prev/next/today buttons)
# - Dense date handling (multiple tasks on same date)
# - Task detail panel when clicking a task

# 4. Run tests
npm test

# 5. Build for production
npm run build

# 6. Start production server
npm start

# ======================================
# Key Files to Explore
# ======================================

# Main Components:
echo "Components:"
ls -la components/Calendar*.tsx
ls -la components/TaskDetail.tsx

# Utilities:
echo "\nUtilities:"
ls -la lib/dateUtils.ts
ls -la lib/timezoneUtils.ts
ls -la lib/calendarHelpers.ts

# Type Definitions:
echo "\nTypes:"
ls -la types/task.ts

# Tests:
echo "\nTests:"
ls -la __tests__/

# Documentation:
echo "\nDocumentation:"
cat CALENDAR_FEATURE.md | head -50

# ======================================
# Environment Information
# ======================================

echo "\n=== Environment ==="
echo "Node version:"
node --version
echo "\nNpm version:"
npm --version
echo "\nReact version:"
grep "\"react\":" package.json

# ======================================
# Troubleshooting
# ======================================

# If you get TypeScript errors:
echo "\nRunning type check..."
npx tsc --noEmit

# If calendar doesn't show:
# 1. Check browser console for errors
# 2. Verify mock data is loading in page.tsx
# 3. Check that all imports are correct
# 4. Ensure _next router is initialized

# If tests fail:
# 1. Clear Jest cache: npm test -- --clearCache
# 2. Update snapshots if needed: npm test -- -u
# 3. Check Node version compatibility

echo "\n✅ Calendar feature is ready to use!"
