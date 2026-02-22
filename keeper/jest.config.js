module.exports = {
  testEnvironment: "node",
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "json-summary"],
  collectCoverageFrom: [
    "**/*.js",
    "!node_modules/**",
    "!coverage/**",
    "!jest.config.js",
  ],
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  testMatch: ["**/__tests__/**/*.js", "**/*.test.js", "**/*.spec.js"],
};
