# Security Policy

## Vulnerability Disclosure Policy

At SoroTask, we take the security of our decentralized task marketplace seriously. If you believe you’ve found a security vulnerability in SoroTask, please let us know right away.

### Reporting a Vulnerability

**Do not report security vulnerabilities via public GitHub issues.**

Please report any identified vulnerabilities by emailing `security@sorolabs.org`.

Your report should include:

- A description of the vulnerability.
- Steps to reproduce (PoC).
- Potential impact.
- Any suggested fixes (if available).

### Scope

The following components are in scope for this policy:

#### Primary Scope (On-chain)

- **Smart Contracts**: All code in `/contract` deployed on Soroban.
- **Protocol Logic**: Any issues related to reward distribution, task execution integrity, or core protocol mechanics.

#### Secondary Scope (Infrastructure & Frontend)

- **Official Keeper Service**: The execution logic in `/keeper` (e.g., DoS, memory leaks, or execution failures).
- **Official Frontend Dashboard**: The user interface in `/frontend` (e.g., XSS, UI manipulation, or phish-prone components).

### Prohibited Actions

- Any testing that interferes with other users' tasks or funds.
- Denial of Service (DoS) attacks.
- Social engineering or physical security attacks.
- Publicly disclosing the vulnerability before we have had a chance to fix it.

### Our Commitment

We will acknowledge your report within **48 hours** and provide a timeline for resolution based on the severity of the issue.

- **Acknowledgment**: Within 2 working days.
- **Initial Evaluation**: Within 5 working days.
- **Resolution**: Dependent on severity (aiming for < 30 days).

---

## Repository and Supply-Chain Security

Because SoroTask accepts contributions from the public, `main` is protected by
automated and manual gates:

- **Security IOC Scan** — runs on every pull request and scans changed files for
  editor auto-run tasks, install-time scripts, alternate package registries,
  config-file injections, obfuscated payloads, credential material, binary/font
  files, and suspicious network calls.
- **Dependency Review** — fails pull requests that introduce high-severity known
  vulnerabilities.
- **Code owner review** — changes to workflows, scripts, infrastructure, contracts,
  proof code, dependency manifests, and shell scripts require review from
  `@SoroLabs/core-devs`.
- **Secret scanning and push protection** — GitHub blocks commits containing
  detected credentials before they reach the repository.
- **Dependabot alerts and security updates** — vulnerable dependencies are reported
  and patched automatically.
- **Fork pull request approval** — workflows on PRs from external contributors
  require maintainer approval before running.

Merging is blocked while a security check is failing. If you believe a check is
producing a false positive, contact `security@sorolabs.org` rather than bypassing it.

---

_Safe Harbor: If you conduct your security research activities within this policy, we will not initiate legal action against you._
