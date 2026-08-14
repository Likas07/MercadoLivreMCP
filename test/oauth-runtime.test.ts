import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function textContent(result: unknown): Record<string, unknown> {
  const parsedResult = CallToolResultSchema.parse(result);
  const text = parsedResult.content.find((content) => content.type === "text");
  assert.equal(text?.type, "text");
  return JSON.parse(text.text) as Record<string, unknown>;
}

test("logout wins over an in-flight token refresh and clears model-visible auth state", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "mercadolivre-mcp-logout-"));
  const tokenStorePath = path.join(temporaryDirectory, "auth.json");
  await writeFile(
    tokenStorePath,
    `${JSON.stringify({
      access_token: "expired-access-token",
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      expires_at_ms: 0,
      refresh_token: "single-use-refresh-token"
    })}\n`,
    { mode: 0o600 }
  );

  let markRefreshStarted!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  let releaseRefresh!: () => void;
  const refreshRelease = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  const apiServer = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/oauth/token") {
      markRefreshStarted();
      await refreshRelease;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "replacement-access-token",
          expires_in: 21600,
          refresh_token: "replacement-refresh-token",
          scope: "read",
          token_type: "Bearer",
          user_id: "test-user-id"
        })
      );
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const address = apiServer.address();
  assert(address && typeof address === "object");

  const client = new Client({ name: "oauth-runtime-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    env: {
      ...processEnvironment(),
      MELI_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      MELI_TOKEN_STORE_PATH: tokenStorePath
    }
  });

  try {
    await client.connect(transport);
    const dataCall = client
      .callTool({ name: "meli_get", arguments: { path: "/users/me" } })
      .catch((error: unknown) => error);

    await refreshStarted;
    const logoutResult = textContent(
      await client.callTool({ name: "meli_auth_logout", arguments: {} })
    );
    assert.deepEqual(logoutResult, { disconnected: true });

    releaseRefresh();
    await dataCall;

    await assert.rejects(stat(tokenStorePath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    const statusResult = await client.callTool({ name: "meli_setup_status", arguments: {} });
    const status = textContent(statusResult);
    assert.equal(status.ready, false);
    assert.equal(status.auth_mode, "missing");
    assert.equal(JSON.stringify(status).includes("token_store_path"), false);
    assert.equal(JSON.stringify(status).includes("user_id"), false);
  } finally {
    releaseRefresh();
    await client.close().catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      apiServer.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
