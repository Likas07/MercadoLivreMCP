import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AuthGenerationGuard,
  createOAuthAuthorizationRequest,
  DEFAULT_ELICITATION_TIMEOUT_MS,
  resolveElicitationTimeoutMs,
  validateAuthorizationRedirect
} from "../src/oauth-security.js";

const expectedState = "expected-state";
const redirectUri = "https://meli-dev.example.com/oauth/mercadolivre/callback";

test("builds an S256 PKCE authorization request", () => {
  const request = createOAuthAuthorizationRequest({
    authBase: "https://auth.mercadolivre.com.br",
    clientId: "test-client-id",
    redirectUri
  });
  const authorizationUrl = new URL(request.authorizationUrl);
  const expectedChallenge = crypto
    .createHash("sha256")
    .update(request.codeVerifier)
    .digest("base64url");

  assert.equal(authorizationUrl.origin, "https://auth.mercadolivre.com.br");
  assert.equal(authorizationUrl.pathname, "/authorization");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "test-client-id");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(authorizationUrl.searchParams.get("state"), request.state);
  assert.equal(authorizationUrl.searchParams.get("code_challenge"), expectedChallenge);
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(request.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(request.state, /^[A-Za-z0-9_-]{22}$/);
});

test("invalidates stale OAuth mutations", () => {
  const guard = new AuthGenerationGuard();
  const capturedGeneration = guard.capture();

  assert.equal(guard.isCurrent(capturedGeneration), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(capturedGeneration), false);
  assert.equal(guard.isCurrent(guard.capture()), true);
});

test("accepts a full redirect URL with matching callback and state", () => {
  const result = validateAuthorizationRedirect(
    `${redirectUri}?code=authorization-code&state=${expectedState}`,
    expectedState,
    redirectUri
  );

  assert.deepEqual(result, { code: "authorization-code" });
});

test("rejects a bare authorization code", () => {
  assert.throws(
    () => validateAuthorizationRedirect("authorization-code", expectedState, redirectUri),
    /full redirected URL/
  );
});

test("rejects a redirect without state", () => {
  assert.throws(
    () => validateAuthorizationRedirect(`${redirectUri}?code=authorization-code`, expectedState, redirectUri),
    /state is missing or does not match/
  );
});

test("rejects a redirect with mismatched state", () => {
  assert.throws(
    () =>
      validateAuthorizationRedirect(
        `${redirectUri}?code=authorization-code&state=attacker-state`,
        expectedState,
        redirectUri
      ),
    /state is missing or does not match/
  );
});

test("rejects a redirect to an unexpected callback", () => {
  assert.throws(
    () =>
      validateAuthorizationRedirect(
        `https://attacker.example/callback?code=authorization-code&state=${expectedState}`,
        expectedState,
        redirectUri
      ),
    /unexpected callback URI/
  );
});

test("preserves configured static query parameters", () => {
  const configuredRedirect = `${redirectUri}?environment=development`;
  const result = validateAuthorizationRedirect(
    `${configuredRedirect}&code=authorization-code&state=${expectedState}`,
    expectedState,
    configuredRedirect
  );

  assert.deepEqual(result, { code: "authorization-code" });
});

test("model-visible auth responses do not expose connected user IDs", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /user_id:\s*this\.storedAuth\.user_id\s*\?\?\s*null/);
  assert.doesNotMatch(source, /user_id:\s*token\.user_id\s*\?\?\s*null/);
});

test("connected user ID remains in the private persisted token record", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(source, /user_id:\s*token\.user_id,\s*\n\s*updated_at:/);
});

test("interactive OAuth elicitations allow enough time for human input", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const elicitationCalls = source.match(/server\.server\.elicitInput\(/g) ?? [];
  const timeoutOptions = source.match(/}, elicitationRequestOptions\(\)\);/g) ?? [];

  assert.equal(DEFAULT_ELICITATION_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(resolveElicitationTimeoutMs(undefined), DEFAULT_ELICITATION_TIMEOUT_MS);
  assert.equal(resolveElicitationTimeoutMs("120000"), 120000);
  assert.equal(resolveElicitationTimeoutMs("invalid"), DEFAULT_ELICITATION_TIMEOUT_MS);
  assert.equal(elicitationCalls.length, 3);
  assert.equal(timeoutOptions.length, elicitationCalls.length);
});

test("OAuth logout invalidates in-flight mutations and clears stored credentials", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(source, /await tokenProvider\.clearStoredAuth\(\)/);
  assert.match(source, /this\.authGeneration\.invalidate\(\)/);
  assert.match(source, /this\.authGeneration\.isCurrent\(authGeneration\)/);
  assert.match(source, /await this\.serializeAuthMutation/);
  assert.match(source, /this\.storedAuth = \{\}/);
  assert.match(source, /this\.accessToken = this\.env\.MELI_ACCESS_TOKEN/);
  assert.match(source, /this\.refreshToken = this\.env\.MELI_REFRESH_TOKEN/);
  assert.match(source, /this\.expiresAtMs = this\.accessToken \? Number\.POSITIVE_INFINITY : 0/);
});

test("model-visible auth responses do not expose token-store paths", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /token_store_path:\s*tokenStorePath\(\)/);
});
