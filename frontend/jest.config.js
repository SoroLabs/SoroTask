/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customConfig = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'app/**/*.{js,jsx,ts,tsx}',
    'components/**/*.{js,jsx,ts,tsx}',
    'src/**/*.{js,jsx,ts,tsx}',
    '!app/**/*.d.ts',
    '!components/**/*.d.ts',
    '!src/**/*.d.ts',
    '!app/**/__tests__/**',
    '!components/**/__tests__/**',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  testMatch: [
    '<rootDir>/app/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/app/**/*.{spec,test}.{js,jsx,ts,tsx}',
    '<rootDir>/components/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/components/**/*.{spec,test}.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{spec,test}.{js,jsx,ts,tsx}',
    '<rootDir>/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/__tests__/**/*.{spec,test}.{js,jsx,ts,tsx}',
    '<rootDir>/lib/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/lib/**/*.{spec,test}.{js,jsx,ts,tsx}',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transformIgnorePatterns: ['/node_modules/(?!.*(@noble|@stellar|@scure|@exodus|next-auth))'],
};

module.exports = async () => {
  const config = await createJestConfig(customConfig)();
  return {
    ...config,
    transformIgnorePatterns: [
      '/node_modules/(?!(@noble|@stellar|@scure|@exodus|next-auth|uint8array-extras|openai)/)',
    ],
  };
};
