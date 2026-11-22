import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { gzipSync } from "zlib";

const BUDGET_BYTES = 180 * 1024;
const frontendDir = path.resolve(process.cwd(), "frontend");
const buildDir = path.join(frontendDir, ".next");

type BuildManifest = {
  pages?: Record<string, string[]>;
  rootMainFiles?: string[];
};

function readManifests(): BuildManifest[] {
  const manifestPaths = [
    path.join(buildDir, "build-manifest.json"),
    path.join(buildDir, "app-build-manifest.json"),
    path.join(buildDir, "server", "app-build-manifest.json"),
  ];

  return manifestPaths.flatMap((manifestPath) => {
    if (!fs.existsSync(manifestPath)) return [];
    return [JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BuildManifest];
  });
}

function auditBundleSize(): Array<{ route: string; gzipBytes: number }> {
  execSync("npm run build", {
    cwd: frontendDir,
    stdio: "inherit",
    maxBuffer: 20 * 1024 * 1024,
  });

  const manifests = readManifests();
  const routes = new Map<string, Set<string>>();
  const sharedFiles = new Set(manifests.flatMap((manifest) => manifest.rootMainFiles ?? []));
  for (const manifest of manifests) {
    for (const [route, files] of Object.entries(manifest.pages ?? {})) {
      if (route.startsWith("/api/")) continue;
      const normalizedRoute = route.replace(/\/page$/, "") || "/";
      const routeFiles = routes.get(normalizedRoute) ?? new Set<string>();
      for (const file of [...sharedFiles, ...files]) {
        if (file.endsWith(".js")) routeFiles.add(file);
      }
      routes.set(normalizedRoute, routeFiles);
    }
  }

  if (routes.size === 0) {
    throw new Error("Next.js build completed, but no route JavaScript manifests were found.");
  }

  return Array.from(routes, ([route, files]) => {
    const gzipBytes = Array.from(files).reduce((total, file) => {
      const absolutePath = path.join(buildDir, file);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Bundle manifest references a missing file: ${file}`);
      }
      return total + gzipSync(fs.readFileSync(absolutePath)).byteLength;
    }, 0);
    return { route, gzipBytes };
  }).sort((a, b) => b.gzipBytes - a.gzipBytes);
}

try {
  const routes = auditBundleSize();
  for (const { route, gzipBytes } of routes.slice(0, 5)) {
    console.log(`${route}: ${(gzipBytes / 1024).toFixed(1)} kB gzip initial JavaScript`);
  }

  const largestBundle = routes[0]!;
  if (largestBundle.gzipBytes >= BUDGET_BYTES) {
    console.error(
      `Largest initial route bundle is ${largestBundle.gzipBytes} bytes; budget is ${BUDGET_BYTES} bytes.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Initial route JavaScript is within the ${BUDGET_BYTES}-byte gzip budget.`);
  }
} catch (error) {
  console.error("Bundle audit failed:", error);
  process.exitCode = 1;
}
