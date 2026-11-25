import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "indent": ["error", 2],
      "linebreak-style": ["error", "unix"],
      "quotes": ["error", "single"],
      "semi": ["error", "always"],
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-console": "off",
      "no-trailing-spaces": "error",
      "eol-last": ["error", "always"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "comma-dangle": ["error", "always-multiline"],
      "no-undef": "off"
    }
  }
];
