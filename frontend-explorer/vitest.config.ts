import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Data-layer unit tests (lib/**). Pure TS — no DOM needed — so the `node`
// environment keeps them fast. The `@/` alias mirrors tsconfig paths.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
