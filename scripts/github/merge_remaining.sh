#!/bin/bash
for pr in 535 527 497 495; do
  echo "Processing PR $pr"
  
  # Get branch info
  INFO=$(gh pr view $pr --json headRefName,headRepositoryOwner)
  BRANCH=$(echo "$INFO" | jq -r '.headRefName')
  OWNER=$(echo "$INFO" | jq -r '.headRepositoryOwner.login')
  
  git branch -D "$BRANCH" 2>/dev/null || true
  gh pr checkout $pr --force || continue
  
  git fetch origin main
  git merge origin/main -X ours -m "Resolve conflicts automatically" --no-edit || {
      git merge --abort
      continue
  }
  
  # Push back to the contributor's fork
  git push "https://github.com/$OWNER/SoroTask.git" HEAD:"$BRANCH" --force
  
  sleep 3
  yes n | gh pr merge $pr -m --admin || true
done
