#!/usr/bin/env python3
"""
create_100_hard_production_issues.py
Automated script to batch-create the 100 Hard Production Epics on GitHub (SoroLabs/SoroTask).
"""

import subprocess
import sys
import os
import re
import time

CATALOG_PATH = os.path.expanduser("~/.gemini/antigravity-ide/brain/ebfda7e7-3a26-4cea-bd46-6c4cb8b281d6/mvp_production_100_hard_issues.md")
REPO = "SoroLabs/SoroTask"
DRY_RUN = "--dry-run" in sys.argv

def parse_epics(filepath):
    if not os.path.exists(filepath):
        print(f"Error: Catalog not found at {filepath}")
        sys.exit(1)
        
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    pattern = re.compile(
        r"###\s+\[(SC-HARD-\d+|BE-HARD-\d+|FE-HARD-\d+)\]\s+(.*?)\n"
        r"- \*\*Compounded Sub-Tasks\*\*:\s+(.*?)\n"
        r"- \*\*Target Files\*\*:\s+(.*?)\n"
        r"- \*\*Problem\*\*:\s+(.*?)\n"
        r"- \*\*Solution\*\*:\s+(.*?)\n"
        r"- \*\*Acceptance Criteria\*\*:\s+(.*?)(?=\n###|\n---\n#|\Z)",
        re.DOTALL
    )

    epics = []
    for match in pattern.finditer(content):
        tag = match.group(1).strip()
        title = match.group(2).strip()
        subtasks = match.group(3).strip()
        target_files = match.group(4).strip().replace("file:///Users/mac/Documents/DripsMaitainer/SoroTask/", "https://github.com/SoroLabs/SoroTask/blob/main/")
        problem = match.group(5).strip()
        solution = match.group(6).strip()
        criteria = match.group(7).strip()

        # Determine labels based on tag
        if "SC-HARD" in tag:
            labels = ["contract", "advanced", "Architecture", "Security"]
        elif "BE-HARD" in tag:
            labels = ["backend", "advanced", "Architecture"]
        else:
            labels = ["frontend", "advanced", "Architecture"]

        body = (
            f"## 📋 Overview & Compounded Architecture\n"
            f"**Compound Structure**: {subtasks}\n\n"
            f"**Target Files**: {target_files}\n\n"
            f"## 🎯 Problem Statement\n{problem}\n\n"
            f"## 🛠️ Technical Specification & Implementation Plan\n{solution}\n\n"
            f"## ✅ Definition of Done & Acceptance Criteria\n{criteria}\n"
        )

        epics.append({
            "tag": tag,
            "title": f"[{tag}] {title}",
            "body": body,
            "labels": labels
        })

    return epics

def main():
    epics = parse_epics(CATALOG_PATH)
    print(f"Parsed {len(epics)} Hard Epics from catalog.")

    limit = None
    start_idx = 0
    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            limit = int(arg.split("=")[1])
        elif arg.startswith("--start="):
            start_idx = int(arg.split("=")[1]) - 1

    selected = epics[start_idx:start_idx + limit] if limit else epics[start_idx:]
    print(f"Queued {len(selected)} issues for creation (Range: {start_idx + 1} to {start_idx + len(selected)})...")

    for i, epic in enumerate(selected, 1):
        labels_str = ",".join(epic["labels"])
        print(f"[{i}/{len(selected)}] Creating: {epic['title']}...")

        if DRY_RUN:
            print(f"  [DRY RUN] gh issue create --title \"{epic['title']}\" --label \"{labels_str}\"")
            continue

        cmd = [
            "gh", "issue", "create",
            "--repo", REPO,
            "--title", epic["title"],
            "--body", epic["body"],
            "--label", labels_str
        ]

        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print(f"  ✓ Created: {res.stdout.strip()}")
        else:
            print(f"  ❌ Error: {res.stderr.strip()}")

        time.sleep(1.5)  # Rate limiting prevention

    print("\n✓ Finished processing issues.")

if __name__ == "__main__":
    main()
