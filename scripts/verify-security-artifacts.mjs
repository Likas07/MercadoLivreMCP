import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const artifactGroups = [
  {
    name: "dist executable graph",
    files: [path.join(repoRoot, "dist", "index.js"), path.join(repoRoot, "dist", "oauth-security.js")]
  },
  {
    name: "bundled plugin",
    files: [path.join(repoRoot, "plugins", "mercado-livre-mcp", "server", "index.mjs")]
  }
];

for (const artifactGroup of artifactGroups) {
  const sourceParts = await Promise.all(artifactGroup.files.map((file) => readFile(file, "utf8")));
  const source = sourceParts.join("\n");

  assert.match(source, /Mercado Livre OAuth state is missing or does not match/);
  assert.match(source, /Paste the full redirected URL, not a bare authorization code/);
  assert.match(source, /redirectedUrl\.origin !== configuredRedirectUrl\.origin/);
  assert.match(source, /redirectedUrl\.pathname !== configuredRedirectUrl\.pathname/);
  assert.match(source, /redirectedUrl\.searchParams\.get\(name\) !== configuredValue/);
  assert.match(source, /Mercado Livre OAuth redirected to an unexpected callback URI/);
  assert.match(source, /user_id:\s*token\.user_id,\s*\n\s*updated_at:/);
  assert.match(source, /DEFAULT_ELICITATION_TIMEOUT_MS\s*=\s*15\s*\*\s*60\s*\*\s*(?:1000|1e3)/);
  assert.match(source, /code_challenge_method["']?\s*,\s*["']S256/);
  assert.match(source, /OAuth credentials changed while the request was in progress/);
  assert.match(source, /await tokenProvider\.clearStoredAuth\(\)/);
  assert.match(source, /this\.authGeneration\.invalidate\(\)/);
  assert.match(source, /this\.storedAuth\s*=\s*\{\}/);
  assert.doesNotMatch(source, /if \(parsed\.state && parsed\.state !== state\)/);
  assert.doesNotMatch(source, /user_id:\s*this\.storedAuth\.user_id\s*\?\?\s*null/);
  assert.doesNotMatch(source, /user_id:\s*token\.user_id\s*\?\?\s*null/);
  assert.doesNotMatch(source, /token_store_path:\s*tokenStorePath\(\)/);
}

process.stdout.write(`Verified OAuth security invariants in ${artifactGroups.length} executable artifact groups.\n`);
