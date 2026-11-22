module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.(js|jsx)$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/(?!(p-limit|events|@stellar/stellar-sdk|@noble/.*|@scure|uint8array-extras|@exodus)/)"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "json-summary"],
  collectCoverageFrom: [
    "src/concurrency.js",
    "src/fraudDetection.js",
    "src/logger.js",
    "src/reconciliation.js",
    "src/poller.js",
    "src/queue.js",
    "src/registry.js",
    "src/retry.js",
    "src/taskSnapshot.js",
    "src/sloMetrics.js",
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testMatch: ["**/?(*.)+(test|spec).js"],
};
