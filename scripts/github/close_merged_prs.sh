#!/bin/bash

# Script to close all merged PRs on GitHub

PR_LIST=$(gh pr list --state open --limit 100 --json number --jq '.[].number' | sort -n)

echo "Found $(echo "$PR_LIST" | wc -l) PRs to close"
echo "Closing PRs..."

CLOSE_COUNT=0
ERROR_COUNT=0

for PR_NUMBER in $PR_LIST; do
    echo ""
    echo "Processing PR #$PR_NUMBER"
    
    # Try to merge the PR on GitHub
    if gh pr merge $PR_NUMBER --merge --delete-branch 2>&1; then
        echo "✓ Successfully closed PR #$PR_NUMBER"
        CLOSE_COUNT=$((CLOSE_COUNT + 1))
    else
        echo "✗ Failed to close PR #$PR_NUMBER (may already be merged)"
        ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
    
    # Small delay to avoid rate limiting
    sleep 1
done

echo ""
echo "========================================="
echo "Close Summary"
echo "========================================="
echo "✓ Successfully closed: $CLOSE_COUNT PRs"
echo "✗ Failed/Already merged: $ERROR_COUNT PRs"
echo "Total processed: $((CLOSE_COUNT + ERROR_COUNT)) PRs"
echo "========================================="
