#!/bin/bash

# Script to reopen and merge closed PRs

PR_LIST="52 61 62 63 64 70 71 72 73 74 75 76 78 79 151 283 340 341 342 343"

echo "Found $(echo "$PR_LIST" | wc -w) PRs to merge"
echo "Starting merge process..."

MERGE_COUNT=0
ERROR_COUNT=0

for PR_NUMBER in $PR_LIST; do
    echo ""
    echo "========================================="
    echo "Processing PR #$PR_NUMBER"
    echo "========================================="
    
    # Check if PR is closed
    STATE=$(gh pr view $PR_NUMBER --json state --jq '.state')
    echo "Current state: $STATE"
    
    # If closed, reopen it first
    if [ "$STATE" = "CLOSED" ]; then
        echo "Reopening PR #$PR_NUMBER..."
        gh pr reopen $PR_NUMBER
        sleep 1
    fi
    
    # Try to merge the PR
    if git merge origin/pr/$PR_NUMBER --strategy-option=ours --no-edit 2>&1; then
        echo "✓ Successfully merged PR #$PR_NUMBER"
        MERGE_COUNT=$((MERGE_COUNT + 1))
    else
        echo "✗ Failed to merge PR #$PR_NUMBER"
        ERROR_COUNT=$((ERROR_COUNT + 1))
        # Abort any failed merge
        git merge --abort 2>/dev/null || true
    fi
    
    # Small delay
    sleep 0.5
done

echo ""
echo "========================================="
echo "Merge Summary"
echo "========================================="
echo "✓ Successfully merged: $MERGE_COUNT PRs"
echo "✗ Failed: $ERROR_COUNT PRs"
echo "Total processed: $((MERGE_COUNT + ERROR_COUNT)) PRs"
echo "========================================="
