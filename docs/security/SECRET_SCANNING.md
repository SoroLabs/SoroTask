# Secret Scanning and Prevention Guide

This document explains how secret scanning and prevention are implemented in the SoroTask repository.

## Overview

We use **Gitleaks** for automated secret scanning to prevent accidental commits of sensitive credentials (API keys, private keys, etc.).

## CI/CD Integration

### GitHub Actions Workflow

A dedicated GitHub Actions workflow (`.github/workflows/secret-scan.yml`) runs on every push and pull request. This workflow:

- Uses the official Gitleaks Action
- Scans the entire repository history
- Fails the CI if secrets are detected
- Produces detailed reports listing detected patterns

The workflow triggers on:
- All pushes to `main`, `feat/*`, and `feature/*` branches
- All pull requests to `main`, `feat/*`, and `feature/*` branches

## Pre-commit Hooks

### Setup Instructions

To enable pre-commit hooks locally:

1. Install pre-commit:
   ```bash
   pip install pre-commit
   ```

2. Install the git hooks:
   ```bash
   pre-commit install
   ```

3. Verify installation:
   ```bash
   pre-commit run --all-files
   ```

### What Gets Checked

The `.pre-commit-config.yaml` configures these checks:

- **Gitleaks Detection**: Scans for secret patterns before committing
- **Private Key Detection**: Identifies private key files
- **Large Files**: Prevents committing files larger than 1MB
- **JSON Validation**: Ensures JSON files are valid
- **YAML Validation**: Ensures YAML files are valid
- **TOML Validation**: Ensures TOML files are valid

## Configuration Files

### `.gitleaks.toml`

Main Gitleaks configuration file that defines:
- Detection rules (includes default rules from Gitleaks)
- Custom rules for project-specific patterns
- Allowlist configurations for excluding false positives

Key allowlists:
- Test snapshots and fixture directories
- Documentation and README files
- Example environment files (`.env.example`, `.env.template`)
- Build artifacts and dependencies

### `.gitleaksignore`

File for ignoring false positives. Format options:
- `<commit_hash>:<line_number>:<rule_name>` - Ignore specific lines
- `<rule_name>` - Ignore all detections of a specific rule

### `.pre-commit-config.yaml`

Defines all pre-commit hooks that run locally before commits.

## Handling False Positives

If a legitimate value is flagged as a secret:

### Option 1: Add to `.gitleaksignore`
Add an entry to ignore the specific detection:
```
abc123def456:42:potential-api-key
```

### Option 2: Update `.gitleaks.toml`
Add patterns to the allowlist to exclude files or rules:
```toml
[allowlist]
paths = [
  '''path/to/false/positive''',
  '''test/fixtures''',
]
```

### Option 3: Move Sensitive Data
If it's a real secret that was accidentally committed:
1. Rotate all compromised credentials immediately
2. Use tools like `git-filter-branch` to remove from history
3. Force push the cleaned history

## Development Workflow

### Making Commits

When working locally:

1. Your pre-commit hooks will automatically run
2. If secrets are detected, the commit will fail
3. Fix the issues (remove secrets or add to allowlist)
4. Try committing again

### Bypassing Hooks (Not Recommended)

In rare cases where you need to bypass hooks:
```bash
git commit --no-verify
```

⚠️ **Warning**: This should only be used when absolutely necessary and with caution.

## Testing Secret Detection

To manually test if Gitleaks is working:

```bash
# Test with gitleaks CLI (if installed)
gitleaks detect --source . --verbose

# Test pre-commit hooks
pre-commit run gitleaks --all-files
```

## Secrets to Avoid

Never commit:
- Private/secret keys (RSA, Ed25519, etc.)
- API keys and tokens
- Database passwords
- AWS/GCP/Azure credentials
- Private cryptocurrency keys
- OAuth tokens
- SSH keys
- NPM/PyPI authentication tokens

## Additional Resources

- [Gitleaks Documentation](https://github.com/gitleaks/gitleaks)
- [Pre-commit Framework](https://pre-commit.com/)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)

## Troubleshooting

### Gitleaks Action Fails in CI

1. Check the workflow output for specific rules that triggered
2. If it's a false positive, update `.gitleaksignore` or `.gitleaks.toml`
3. Push the fix and re-run the workflow

### Pre-commit Hooks Not Running

1. Verify installation: `pre-commit --version`
2. Reinstall hooks: `pre-commit install`
3. Run manually: `pre-commit run --all-files`

### Need to Update Rules

Edit `.gitleaks.toml` and add new rules following [Gitleaks rule documentation](https://github.com/gitleaks/gitleaks#rules).
