import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const stripReactRules = (config) => ({
  ...config,
  rules: Object.fromEntries(
    Object.entries(config.rules ?? {}).filter(
      ([ruleName]) => !ruleName.startsWith("react/"),
    ),
  ),
});

const eslintConfig = defineConfig([
  ...nextVitals.map(stripReactRules),
  ...nextTs.map(stripReactRules),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ignore auth route for now due to eslint compatibility issue
    "app/api/auth/**",
  ]),
]);

export default eslintConfig;
