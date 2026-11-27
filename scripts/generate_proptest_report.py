#!/usr/bin/env python3
"""Generate JSON and Markdown property-test & mutation-testing regression reports for CI."""

from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import re
from typing import Any


TEST_LINE_RE = re.compile(r"^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED|ignored)\s*$")
SUMMARY_RE = re.compile(
    r"test result:\s+(\w+)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored;"
)


def parse_cargo_test_log(log_text: str) -> dict[str, Any]:
    cases: list[dict[str, str]] = []
    passed = 0
    failed = 0
    ignored = 0

    for line in log_text.splitlines():
        m = TEST_LINE_RE.match(line.strip())
        if m:
            cases.append({"name": m.group(1), "status": m.group(2)})
            continue
        s = SUMMARY_RE.search(line)
        if s:
            passed += int(s.group(2))
            failed += int(s.group(3))
            ignored += int(s.group(4))

    return {
        "passed": passed,
        "failed": failed,
        "ignored": ignored,
        "cases": cases,
    }


def collect_regression_seeds(regressions_dir: pathlib.Path) -> list[dict[str, Any]]:
    seeds: list[dict[str, Any]] = []
    if not regressions_dir.exists():
        return seeds

    for path in sorted(regressions_dir.glob("*.txt")):
        lines = [
            ln.strip()
            for ln in path.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        seeds.append({"file": path.name, "seed_count": len(lines), "seeds": lines})
    return seeds


def parse_mutants_outcomes(mutants_dir: pathlib.Path) -> dict[str, Any]:
    outcomes_path = mutants_dir / "mutants.out" / "outcomes.json"
    if not outcomes_path.exists():
        outcomes_path = mutants_dir / "outcomes.json"

    if not outcomes_path.exists():
        return {"available": False, "caught": 0, "missed": 0, "timeout": 0, "unviable": 0}

    data = json.loads(outcomes_path.read_text(encoding="utf-8"))
    outcomes = data.get("outcomes", [])
    counts = {"caught": 0, "missed": 0, "timeout": 0, "unviable": 0}
    missed_details: list[str] = []

    for item in outcomes:
        summary = item.get("summary", "")
        if summary == "CaughtMutant":
            counts["caught"] += 1
        elif summary == "MissedMutant":
            counts["missed"] += 1
            scenario = item.get("scenario", {})
            missed_details.append(str(scenario))
        elif summary == "Timeout":
            counts["timeout"] += 1
        elif summary == "Unviable":
            counts["unviable"] += 1

    viable = counts["caught"] + counts["missed"] + counts["timeout"]
    kill_rate_pct = 100.0 if viable == 0 else round((counts["caught"] / viable) * 100.0, 2)
    return {
        "available": True,
        **counts,
        "viable": viable,
        "kill_rate_pct": kill_rate_pct,
        "missed_details": missed_details,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish proptest & mutation regression reports.")
    parser.add_argument("--log", required=True, type=pathlib.Path)
    parser.add_argument("--regressions-dir", required=True, type=pathlib.Path)
    parser.add_argument("--mutants-dir", required=True, type=pathlib.Path)
    parser.add_argument("--out-json", required=True, type=pathlib.Path)
    parser.add_argument("--out-md", required=True, type=pathlib.Path)
    args = parser.parse_args()

    log_text = args.log.read_text(encoding="utf-8") if args.log.exists() else ""
    test_summary = parse_cargo_test_log(log_text)
    regression_seeds = collect_regression_seeds(args.regressions_dir)
    mutants_summary = parse_mutants_outcomes(args.mutants_dir)

    report = {
        "suite": "SC-FINAL-49 Formal Fuzzing & Mutation Testing Suite",
        "generated_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "fuzz_iterations_budget": 10_000_000,
        "live_vm_fuzz_budget": 20_000,
        "tests": test_summary,
        "regression_seeds": regression_seeds,
        "cargo_mutants": mutants_summary,
    }

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    md_lines = [
        "## SC-FINAL-49 Property Fuzzing & Mutation Regression Report",
        "",
        f"- **Generated (UTC):** `{report['generated_at_utc']}`",
        f"- **Fuzz Iteration Budget:** `{report['fuzz_iterations_budget']:,}` arithmetic/state-machine iterations + `{report['live_vm_fuzz_budget']:,}` live Soroban VM ops",
        f"- **Property & Boundary Tests:** `{test_summary['passed']}` passed, `{test_summary['failed']}` failed, `{test_summary['ignored']}` ignored",
        f"- **Saved Regression Seed Files:** `{len(regression_seeds)}`",
    ]

    if mutants_summary.get("available"):
        md_lines.extend(
            [
                f"- **cargo-mutants Kill Rate (`src/math.rs`):** `{mutants_summary['kill_rate_pct']}%` "
                f"(`{mutants_summary['caught']}` caught / `{mutants_summary['viable']}` viable, "
                f"`{mutants_summary['missed']}` missed, `{mutants_summary['timeout']}` timeout)",
            ]
        )
    else:
        md_lines.append("- **cargo-mutants:** not executed in this run (see in-suite `test_mutation_kill_rate_100_percent_on_critical_math`)")

    if regression_seeds:
        md_lines.extend(["", "### Regression Seeds", ""])
        for entry in regression_seeds:
            md_lines.append(f"- `{entry['file']}`: {entry['seed_count']} saved seed(s)")

    if test_summary["cases"]:
        md_lines.extend(["", "### Executed Cases", "", "| Test | Status |", "|---|---|"])
        for c in test_summary["cases"]:
            md_lines.append(f"| `{c['name']}` | `{c['status']}` |")

    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
