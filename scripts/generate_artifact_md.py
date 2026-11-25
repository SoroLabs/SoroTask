import os
from scripts.create_150_production_issues import ISSUES

artifact_path = "/Users/mac/.gemini/antigravity-ide/brain/3159c838-bf12-4d54-8da1-6e40c9a045a7/150_production_deployment_issues.md"

with open(artifact_path, "w", encoding="utf-8") as f:
    f.write("# SoroTask: 150 Advanced Production Deployment Issues\n\n")
    f.write("> **Target Goal**: Production readiness, extreme hardening, mainnet deployment, security formal verification, zero-downtime decentralized operations, and enterprise Web3 UX.\n\n")
    f.write("## Table of Contents\n")
    f.write("- [Part 1: Smart Contract Architecture & Security (50 Issues: SC-PROD-01 to SC-PROD-50)](#part-1-smart-contract-architecture--security)\n")
    f.write("- [Part 2: Backend, Keeper Mesh, Indexer & Infrastructure (50 Issues: BE-PROD-01 to BE-PROD-50)](#part-2-backend-keeper-mesh-indexer--infrastructure)\n")
    f.write("- [Part 3: Frontend, Web3 UX, Security & Operations (50 Issues: FE-PROD-01 to FE-PROD-50)](#part-3-frontend-web3-ux-security--operations)\n\n---\n\n")

    def write_section(title, tag_prefix):
        f.write(f"## {title}\n\n")
        section_issues = [i for i in ISSUES if i["tag"].startswith(tag_prefix)]
        for idx, item in enumerate(section_issues, 1):
            tag = item["tag"]
            item_title = item["title"]
            cat = item["category"]
            labels = item["labels"]
            target_files = item["target_files"]
            problem = item["problem"]
            solution = item["solution"]
            subtasks = item["subtasks"]
            criteria = item["criteria"]

            eta = item.get("eta", "3-4 Days (Sprint 1)")

            f.write(f"### #{idx} {item_title}\n\n")
            f.write(f"- **Category**: `{cat}`\n")
            f.write(f"- **Estimated Time to Complete (ETA)**: `{eta}`\n")
            f.write(f"- **Labels**: `{', '.join(labels)}`\n")
            f.write(f"- **Target Files**: `{target_files}`\n\n")
            f.write("#### Compounded Sub-tasks\n")
            if isinstance(subtasks, list):
                for st in subtasks:
                    f.write(f"- [ ] {st}\n")
            else:
                for st in subtasks.split(" + "):
                    cleaned_st = st.strip().lstrip("[").rstrip("]")
                    f.write(f"- [ ] **{cleaned_st}**\n")
            f.write("\n#### Problem Statement\n")
            f.write(f"{problem}\n\n")
            f.write("#### Technical Solution & Architecture\n")
            f.write(f"{solution}\n\n")
            f.write("#### Acceptance Criteria\n")
            if isinstance(criteria, list):
                for ac in criteria:
                    f.write(f"- [ ] {ac}\n")
            else:
                for ac in criteria.split(";"):
                    ac_clean = ac.strip()
                    if ac_clean:
                        f.write(f"- [ ] {ac_clean}\n")
            f.write("\n---\n\n")

    write_section("Part 1: Smart Contract Architecture & Security", "SC-")
    write_section("Part 2: Backend, Keeper Mesh, Indexer & Infrastructure", "BE-")
    write_section("Part 3: Frontend, Web3 UX, Security & Operations", "FE-")

print("Generated artifact size:", os.path.getsize(artifact_path))
