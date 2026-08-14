import crypto from "node:crypto";

export type ValidatedAuthorizationRedirect = {
  code: string;
};

export const DEFAULT_ELICITATION_TIMEOUT_MS = 15 * 60 * 1000;

export function resolveElicitationTimeoutMs(value: string | undefined): number {
  if (!value) return DEFAULT_ELICITATION_TIMEOUT_MS;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ELICITATION_TIMEOUT_MS;
}

export class AuthGenerationGuard {
  private generation = 0;

  capture(): number {
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

export function createOAuthAuthorizationRequest(input: {
  authBase: string;
  clientId: string;
  redirectUri: string;
}): {
  authorizationUrl: string;
  codeVerifier: string;
  state: string;
} {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = base64Url(crypto.randomBytes(16));
  const authorizationUrl = new URL("/authorization", input.authBase);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set("redirect_uri", input.redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return { authorizationUrl: authorizationUrl.toString(), codeVerifier, state };
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function validateAuthorizationRedirect(
  value: string,
  expectedState: string,
  expectedRedirectUri: string
): ValidatedAuthorizationRedirect {
  let redirectedUrl: URL;
  let configuredRedirectUrl: URL;

  try {
    redirectedUrl = new URL(value);
  } catch {
    throw new Error("Paste the full redirected URL, not a bare authorization code.");
  }

  try {
    configuredRedirectUrl = new URL(expectedRedirectUri);
  } catch {
    throw new Error("The configured Mercado Livre redirect URI is not a valid URL.");
  }

  if (
    redirectedUrl.origin !== configuredRedirectUrl.origin ||
    redirectedUrl.pathname !== configuredRedirectUrl.pathname
  ) {
    throw new Error("Mercado Livre OAuth redirected to an unexpected callback URI. Restart meli_auth_connect.");
  }

  for (const [name, configuredValue] of configuredRedirectUrl.searchParams) {
    if (redirectedUrl.searchParams.get(name) !== configuredValue) {
      throw new Error("Mercado Livre OAuth redirected to an unexpected callback URI. Restart meli_auth_connect.");
    }
  }

  const code = redirectedUrl.searchParams.get("code");
  if (!code) {
    throw new Error("Mercado Livre OAuth redirect is missing the authorization code. Restart meli_auth_connect.");
  }

  const returnedState = redirectedUrl.searchParams.get("state");
  if (!returnedState || returnedState !== expectedState) {
    throw new Error("Mercado Livre OAuth state is missing or does not match. Restart meli_auth_connect.");
  }

  return { code };
}
