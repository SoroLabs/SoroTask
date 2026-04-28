#!/bin/bash

# This script reads the 'frontend_issues.md' file and uses the GitHub CLI ('gh')
# to create each issue in your repository.
# v2: Corrected label and body parsing logic.

# --- Prerequisites ---
# 1. Make sure you are in a directory that is a git repository with a GitHub remote.
# 2. Install the GitHub CLI: https://cli.github.com/
# 3. Authenticate with GitHub: Run `gh auth login`

set -e # Exit immediately if a command exits with a non-zero status.

# --- Configuration ---
INPUT_FILE="frontend_issues.md"
REPO=$(gh repo view --json owner,name -q '.owner.login + "/" + .name' 2>/dev/null)

# --- Sanity Checks ---
if ! command -v gh &> /dev/null; then
    echo "ERROR: GitHub CLI 'gh' is not installed. Please install it to continue."
    echo "Installation guide: https://cli.github.com/"
    exit 1
fi

if ! gh auth status &>/dev/null; then
    echo "ERROR: You are not authenticated with the GitHub CLI."
    echo "Please run 'gh auth login' and try again."
    exit 1
fi

if [ -z "$REPO" ]; then
    echo "ERROR: Could not automatically detect GitHub repository."
    echo "Please ensure you are in a git repository with a remote pointing to github.com."
    exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
    echo "ERROR: The file '$INPUT_FILE' was not found in the current directory."
    exit 1
fi

echo "This script will create multiple issues in the '$REPO' repository."
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operation cancelled."
    exit 0
fi

# --- Main Logic ---

# Create a temporary directory to hold individual issue files
TMP_DIR=$(mktemp -d)

# Cleanup the temp directory on script exit
trap 'rm -rf -- "$TMP_DIR"' EXIT

# Split the main markdown file into smaller files, one for each issue.
csplit -s -f "$TMP_DIR/issue-" -n 3 "$INPUT_FILE" '/<hr>/' '{*}'

echo "Found $(ls -1q "$TMP_DIR" | wc -l) issues to create..."

# Process each individual issue file
for issue_file in "$TMP_DIR"/issue-*; do
    # Skip empty files that might be created by csplit
    if [ ! -s "$issue_file" ]; then
        continue
    fi

    # Extract the title
    TITLE=$(grep -m 1 "### Title:" "$issue_file" | sed 's/### Title: //')

    # Extract labels from the "Labels:" line
    LABELS1=$(grep -m 1 "^\*\*Labels\*\*:" "$issue_file" | sed 's/^\*\*Labels\*\*:\s*//' || true)
    # Extract the custom label as another label
    LABELS2=$(grep -m 1 "^\*\*Custom Label\*\*:" "$issue_file" | sed 's/^\*\*Custom Label\*\*:\s*//' || true)

    # Combine them with a comma, handling cases where one might be empty
    if [ -n "$LABELS1" ] && [ -n "$LABELS2" ]; then
        ALL_LABELS="$LABELS1,$LABELS2"
    elif [ -n "$LABELS1" ]; then
        ALL_LABELS="$LABELS1"
    elif [ -n "$LABELS2" ]; then
        ALL_LABELS="$LABELS2"
    else
        ALL_LABELS=""
    fi
    
    # Extract the body robustly.
    # This prints all lines from "**Description**:" to the end, then deletes the first line.
    BODY=$(sed -n '/^\*\*Description\*\*:/,$p' "$issue_file" | sed '1d')

    if [ -z "$TITLE" ]; then
        echo "Skipping a section that doesn't look like an issue."
        continue
    fi

    # Check if body is empty, which caused the previous error
    if [ -z "$BODY" ]; then
        echo "-----------------------------------------------------"
        echo "ERROR: Could not extract body for issue: $TITLE"
        echo "Skipping this issue."
        continue
    fi

    echo "-----------------------------------------------------"
    echo "Creating issue: $TITLE"
    echo "With labels: $ALL_LABELS"
    
    # Use 'gh issue create' to create the issue.
    echo "$BODY" | gh issue create \
      --repo "$REPO" \
      --title "$TITLE" \
      --body-file - \
      --label "$ALL_LABELS"

    # Sleep for a moment to avoid hitting the GitHub API rate limit.
    echo "Waiting 2 seconds to avoid rate limiting..."
    sleep 2
done

echo "-----------------------------------------------------"
echo "Done! All issues have been created."