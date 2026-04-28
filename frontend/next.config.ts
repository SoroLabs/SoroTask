import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler is stable in Next.js 16 — automatic memoization without manual useMemo/useCallback.
  // The babel-plugin-react-compiler devDependency is no longer needed; Next.js 16 bundles this natively.
  reactCompiler: true,

  // Turbopack is the default bundler in Next.js 16.
  // To opt out and use webpack instead, run: next build --webpack
  // No explicit turbopack config is needed unless you have custom loaders.

  // Image optimisation defaults changed in Next.js 16:
  //   - minimumCacheTTL: 60s → 14400s (4 hours)
  //   - imageSizes: removed 16 from defaults
  //   - qualities: [1..100] → [75]
  // These new defaults are intentional and no override is needed for this project.
};

export default nextConfig;
