# Testing SoroTask Frontend

This project uses **Playwright** for end-to-end (E2E) browser testing and **Jest** for unit testing.

## End-to-End (E2E) Testing

E2E tests protect the most important user journeys by simulating real user behavior in Chromium, Firefox, and Webkit.

### Prerequisites

Ensure you have installed the dependencies:

```bash
cd frontend
npm install
npx playwright install --with-deps
```

### Running Tests

To run the E2E tests in headless mode:

```bash
npm run test:e2e
```

To run tests in UI mode (interactive):

```bash
npx playwright test --ui
```

### Test Coverage

The E2E suite covers:
- Dashboard load and initial state.
- Wallet connection simulation.
- Task registration flow (form submission and list updates).
- UI responsiveness and accessibility markers (`data-testid`).

## Unit Testing

Unit tests are managed via Jest and React Testing Library.

```bash
npm run test
```

To run tests with coverage:

```bash
npm run test:coverage
```
