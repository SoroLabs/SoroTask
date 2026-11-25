#!/bin/bash
git config --global user.email "bot@example.com"
git config --global user.name "Bot"

# Get all PRs that are open
for pr in $(gh pr list --json number --jq '.[].number'); do
  echo "Processing PR $pr"
  
  # Checkout the PR locally
  if ! gh pr checkout $pr --force; then
    echo "Failed to checkout PR $pr, skipping"
    continue
  fi
  
  git fetch origin main
  
  # Check if there are conflicts by trying to merge without committing
  if ! git merge origin/main -X ours -m "Resolve conflicts automatically" --no-edit; then
    echo "Merge failed for $pr, aborting merge and skipping"
    git merge --abort
    git reset --hard origin/main || true
    continue
  fi
  
  # Push the resolved branch to its origin
  if ! git push; then
    echo "Push failed for $pr, trying force push..."
    if ! git push --force; then
        echo "Force push failed, skipping"
        continue
    fi
  fi
  
  # Give GitHub a few seconds to update PR state
  sleep 3
  
  # Finally merge the PR
  echo "Merging PR $pr"
  yes n | gh pr merge $pr -m --admin || true
done

git checkout main
