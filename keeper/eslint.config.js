module.exports = [
  {
    ignores: ["node_modules/**", "coverage/**", "dist/**", "build/**"],
  },
  {
    files: ["src/**/*.js", "__tests__/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {},
  },
];
