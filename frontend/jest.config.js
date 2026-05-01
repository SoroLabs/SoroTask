/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest')

// next/jest returns a function that wraps your Jest config with Next.js defaults.
// The wrapper itself is synchronous in Next.js 16 — no need for async/await.
const createJestConfig = nextJest({
  dir: './',
})

  return nextConfig({
    coverageProvider: 'v8',
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    collectCoverageFrom: [
      'app/**/*.{js,jsx,ts,tsx}',
      'src/**/*.{js,jsx,ts,tsx}',
      '!app/**/*.d.ts',
      '!src/**/*.d.ts',
      '!app/**/__tests__/**',
      '!src/**/__tests__/**',
      '!src/**/__mocks__/**',
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
      '<rootDir>/app/**/__tests__/**/*.{js,jsx,ts,tsx}',
      '<rootDir>/app/**/*.{spec,test}.{js,jsx,ts,tsx}',
      '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
      '<rootDir>/src/**/*.{spec,test}.{js,jsx,ts,tsx}',
      '<rootDir>/app/**/*.{spec,test}.{js,jsx,ts,tsx}',
    ],
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/$1',
    },
  })
}

module.exports = createJestConfig(customConfig)
