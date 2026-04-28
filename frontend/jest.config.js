const nextJest = require('next/jest')

// next/jest returns a function that wraps your Jest config with Next.js defaults.
// The wrapper itself is synchronous in Next.js 16 — no need for async/await.
const createJestConfig = nextJest({
  dir: './',
})

/** @type {import('jest').Config} */
const customConfig = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    // The project uses the Next.js App Router (app/) not a src/ directory.
    'app/**/*.{js,jsx,ts,tsx}',
    '!app/**/*.d.ts',
    '!app/**/*.stories.{js,jsx,ts,tsx}',
    '!app/**/__tests__/**',
    '!app/**/__mocks__/**',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  testMatch: [
    // Match tests co-located with app/ source files.
    '<rootDir>/app/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/app/**/*.{spec,test}.{js,jsx,ts,tsx}',
    // Also support a top-level __tests__ directory if added later.
    '<rootDir>/__tests__/**/*.{js,jsx,ts,tsx}',
  ],
  moduleNameMapper: {
    // Align with tsconfig.json paths: @/* maps to the project root.
    '^@/(.*)$': '<rootDir>/$1',
  },
  // @stellar/freighter-api ships as ESM — tell Jest to transform it via Babel.
  transformIgnorePatterns: [
    '/node_modules/(?!(@stellar/freighter-api)/)',
  ],
}

module.exports = createJestConfig(customConfig)
