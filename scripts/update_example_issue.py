import sys
sys.path.insert(0, ".")
from scripts.create_150_production_issues import ISSUES
import subprocess

issue = ISSUES[0]
repo = "SoroLabs/SoroTask"

subtasks_formatted = ""
for st in issue["subtasks"].split(" + "):
    cleaned = st.strip().lstrip("[").rstrip("]")
    subtasks_formatted += f"- [ ] **{cleaned}**\n"

criteria_formatted = ""
for ac in issue["criteria"].split(";"):
    ac_clean = ac.strip()
    if ac_clean:
        criteria_formatted += f"- [ ] {ac_clean}\n"

body = f"""### {issue['title']}

- **Category**: `{issue['category']}`
- **Estimated Time to Complete (ETA)**: `{issue['eta']}`
- **Labels**: `{', '.join(issue['labels'])}`
- **Target Files**: `{issue['target_files']}`

#### Compounded Sub-tasks
{subtasks_formatted}
#### Problem Statement
{issue['problem']}

#### Technical Architecture & Solution
{issue['solution']}

#### Acceptance Criteria
{criteria_formatted}
"""

with open("/tmp/issue_1375_body.md", "w") as f:
    f.write(body)

cmd = [
    "gh", "issue", "edit", "1375",
    "--repo", repo,
    "--body-file", "/tmp/issue_1375_body.md"
]
subprocess.run(cmd, check=True)
print("Updated issue 1375 successfully!")
