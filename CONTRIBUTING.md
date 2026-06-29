# Contributing to SoroTask

Thanks for contributing to SoroTask. This project is split into three parts:

- `contract` (Rust/Soroban smart contract)
- `keeper` (Node.js off-chain bot)
- `frontend` (Next.js dashboard)

## Contribution Flow

1. Fork the repository.
2. Create a branch from `main`:
   - `feat/<short-description>` for features
   - `fix/<short-description>` for bug fixes
   - `docs/<short-description>` for documentation
3. Make focused changes in the relevant package(s).
4. Run formatting/lint checks before opening a PR.
5. Open a Pull Request using the PR template.

Keep each PR scoped to one issue or one tightly related change. If a fix spans
multiple packages, explain why in the PR summary and list the package-specific
checks you ran.

## Local Setup

Install dependencies only for the package you are changing unless your work
touches cross-package behavior.

### Contract

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
cargo test
```

### Keeper

```bash
cd keeper
npm install
node index.js
npm test
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Development Workflow

1. Sync your fork with upstream `main`.
2. Create a focused branch using the prefixes listed above.
3. Read the relevant package README before changing code.
4. Make the smallest change that fully addresses the issue.
5. Add or update tests when behavior changes.
6. Run the package checks listed below.
7. Open a PR and complete the template.
8. Respond to review comments with follow-up commits on the same branch.

Suggested commands:

```bash
git checkout main
git pull upstream main
git checkout -b feat/my-change
```

If your PR resolves an issue, include `Closes #123` in the PR body so GitHub and
the Stellar Wave tracker can associate the work with the issue.

## Code Style and Quality Checks

Run the checks for the part(s) you changed.

### Rust (contract)

```bash
cd contract
cargo fmt --all
cargo clippy --all-targets --all-features
cargo test
```

### Keeper (Node.js)

```bash
cd keeper
npm install
npm run lint
npm test
```

### JavaScript/TypeScript (frontend)

```bash
cd frontend
npm install
npm run lint
npm test
```

If you changed both Rust and frontend code, run both checks.

## Automated CI Requirements

All pull requests must pass the following automated checks before they can be merged:

### Keeper Service (`keeper/**`)
- **Lint**: ESLint validation of all JavaScript files
- **Test**: Jest test suite with minimum 70% code coverage
- **Docker**: Dockerfile successfully builds without errors

### Contract (`contract/**`)
- **Formatting**: Rust code formatted with `cargo fmt`
- **Linting**: Rust code passes `cargo clippy` checks
- **Tests**: All Rust unit tests pass
- **Build**: WebAssembly compilation succeeds

These checks run automatically on every pull request. You can verify locally before pushing:

```bash
# For Keeper changes
cd keeper && npm run lint && npm test

# For Contract changes
cd contract && cargo fmt --all && cargo test && cargo clippy --all-targets
```

## Pull Request Expectations

Every PR should:

- Have a clear title and summary.
- Explain what changed and why.
- Link related issue(s) when applicable.
- Include testing notes (what was run and results).
- Keep scope focused; avoid unrelated refactors.
- Include screenshots or short recordings for frontend UI changes.
- Confirm whether migrations, environment variables, or deployment steps are required.
- Call out any checks you could not run and why.

The repository includes `.github/pull_request_template.md`. Fill it out instead
of deleting sections:

- **Summary**: what changed and why.
- **Related Issue**: use `Closes #123` when the PR should complete an issue.
- **Type of Change**: mark every applicable category.
- **Changes Made**: list the concrete files or behaviors changed.
- **Validation**: paste the exact commands you ran and their results.
- **Screenshots**: required for visible frontend changes.
- **Checklist**: confirm scope, docs, commits, and assignment expectations.

Reviewers should be able to understand the intent, reproduce validation, and
decide whether the PR is safe without reading unrelated files.

## Commit Guidance

- Use small, reviewable commits.
- Use Conventional Commits so automated releases can determine version bumps and changelog entries.
- Write clear commit messages describing intent.
- Keep each commit logically coherent.

Examples:

| Type | Use for | Example |
| --- | --- | --- |
| `feat` | New user-visible behavior or capability | `feat(frontend): add task filters` |
| `fix` | Bug fixes | `fix(keeper): retry failed task polling` |
| `docs` | Documentation-only changes | `docs: expand contributor workflow` |
| `test` | Test-only changes | `test(contract): cover paused execution` |
| `ci` | GitHub Actions or automation changes | `ci: cache Rust dependencies` |
| `chore` | Maintenance with no user-facing behavior change | `chore: update tooling config` |
| `refactor` | Code restructuring without behavior change | `refactor(frontend): split task form helpers` |

```text
feat(frontend): add wallet connection guard
fix(keeper): retry failed task polling
chore(contract): update soroban-sdk
```

Version bump behavior:

- `fix:` triggers a patch release.
- `feat:` triggers a minor release.
- `!` or `BREAKING CHANGE:` triggers a major release.

Breaking changes must be marked with `!` or a `BREAKING CHANGE:` footer:

```text
feat(contract)!: change task registration payload

BREAKING CHANGE: register now requires a resolver policy field.
```

## Reporting Bugs and Requesting Features

When opening an issue, include:

- What you expected to happen.
- What actually happened.
- Steps to reproduce.
- Environment details (OS, runtime/tool versions) when relevant.
