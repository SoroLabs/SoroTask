# Codecov Integration Setup Guide

## ✅ Prerequisites

1. **Codecov Account**: https://codecov.io
2. **GitHub Repository Access**: You need admin access to SoroLabs/SoroTask
3. **GitHub Secrets Access**: https://github.com/SoroLabs/SoroTask/settings/secrets/actions

## 🔑 Setup Steps

### Step 1: Generate Codecov Token

1. Visit https://codecov.io and sign in with GitHub
2. Select the SoroLabs organization
3. Navigate to **Settings** → **Account** → **Upload token**
4. Copy the generated token (do NOT share this publicly)

### Step 2: Add GitHub Secret

1. Go to https://github.com/SoroLabs/SoroTask/settings/secrets/actions
2. Click **New repository secret**
3. Name: `CODECOV_TOKEN`
4. Value: Paste the token from Step 1
5. Click **Add secret**

### Step 3: Verify Installation

1. Create a test branch: `git checkout -b test/coverage-setup`
2. Make a small change
3. Push and open a pull request
4. GitHub Actions will run automatically
5. Check the PR for the coverage report comment

## 📊 What Gets Measured

### Rust Coverage (cargo-tarpaulin)
- Line coverage of contract code
- Branch coverage
- Excludes fuzz targets automatically
- Timeout: 600 seconds

### Frontend Coverage (Jest)
- Statements, Branches, Functions, Lines
- Covers Next.js React components
- Minimum thresholds: 70% for all metrics
- Excludes node_modules and .next

## 🎯 Coverage Thresholds

All metrics must meet **70% minimum**:
- ✅ Statements: 70%+
- ✅ Branches: 70%+
- ✅ Functions: 70%+
- ✅ Lines: 70%+

## 📈 Viewing Reports

- **Codecov Dashboard**: https://codecov.io/gh/SoroLabs/SoroTask
- **Per-PR**: Codecov comment appears automatically
- **Badge**: Add to README.md:
  ```markdown
  [![codecov](https://codecov.io/gh/SoroLabs/SoroTask/branch/main/graph/badge.svg?token=YOUR_TOKEN)](https://codecov.io/gh/SoroLabs/SoroTask)