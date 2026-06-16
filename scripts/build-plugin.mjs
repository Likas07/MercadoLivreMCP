import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "plugins", "mercado-livre-mcp", "server");

await mkdir(outputDir, { recursive: true });

await build({
  entryPoints: [path.join(repoRoot, "src", "index.ts")],
  outfile: path.join(outputDir, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false
});
