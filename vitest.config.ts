import { isAbsolute, join } from "node:path";
import { defineConfig } from "vitest/config";

// Reuse the existing project placement input only when supplied by the native caller.
// Test-order metadata is not worth an implicit mutable cache in the installed environment.
const cache = process.env["NDDEV_DS_CACHE"];
if (cache && !isAbsolute(cache))
  throw new Error("NDDEV_DS_CACHE must be an absolute native placement");
export default defineConfig({
  ...(cache ? { cacheDir: join(cache, "vitest") } : {}),
  test: { include: ["tests/**/*.test.ts"], cache: Boolean(cache) },
});
