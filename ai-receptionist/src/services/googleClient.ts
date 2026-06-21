// Thin wrapper around googleapis for the read-only Google Calendar connection.
// SUB-BATCH 2: OAuth connect/callback + token refresh wiring. NO calendar listing
// UI, NO free-busy, NO write scope, NO availability wiring.
//
// Config is read from process.env at CALL time (not boot) so it can be provisioned
// /rotated at runtime and set by tests without editing .env — same approach as
// tokenCrypto. env.ts still declares these vars for documentation + boot.

import { google, Auth } from "googleapis";
import { getDecryptedConnection, updateAccessToken, upsertGoogleConnection } from "./googleConnectionService";

// Derive the client type from the constructor we actually use, so it always
// matches (googleapis bundles its own google-auth-library copy; annotating with
// the top-level Auth.OAuth2Client would mismatch).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

// READ-ONLY ONLY. Requesting a write scope here would be a scope-creep bug — the
// whole point of this phase is read-only busy/free. Do NOT add calendar (rw),
// calendar.events, or any *.events scope.
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"] as const;

function cfg() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
    redirectOverride: process.env.GOOGLE_OAUTH_REDIRECT_URL || "",
  };
}

/** True only when both OAuth client credentials are present. */
export function googleConfigured(): boolean {
  const c = cfg();
  return !!(c.clientId && c.clientSecret);
}

/** The OAuth callback URL: explicit override, else APP_BASE_URL + the callback path. */
export function resolveRedirectUrl(): string {
  const c = cfg();
  if (c.redirectOverride) return c.redirectOverride;
  return `${c.appBaseUrl.replace(/\/+$/, "")}/api/google/oauth/callback`;
}

function makeOAuth2Client(): OAuth2Client {
  const c = cfg();
  return new google.auth.OAuth2(c.clientId, c.clientSecret, resolveRedirectUrl());
}

/** Build Google's consent URL. offline + prompt=consent so a refresh token is
 *  reliably returned on first connect; `state` is the one-time CSRF nonce. */
export function buildConsentUrl(state: string): string {
  return makeOAuth2Client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES as unknown as string[],
    state,
  });
}

/** Exchange the authorization code for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<Auth.Credentials> {
  const client = makeOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * REFRESH-TOKEN PRESERVATION. Google only returns a refresh token on first
 * consent. Pass the value through to storage ONLY when present; return `undefined`
 * otherwise so the storage layer KEEPS the existing refresh token (never wipes it).
 */
export function chooseRefreshTokenForStore(refreshToken?: string | null): string | undefined {
  return refreshToken && refreshToken.length > 0 ? refreshToken : undefined;
}

/**
 * The connected account's email = the id of its PRIMARY calendar. This stays
 * within the read-only calendar scope (no extra userinfo/email scope). Best-effort:
 * returns null on any failure (the status line just shows "connected").
 */
export async function fetchAccountEmail(authedClient: OAuth2Client): Promise<string | null> {
  try {
    const cal = google.calendar({ version: "v3", auth: authedClient });
    const primary = await cal.calendarList.get({ calendarId: "primary" });
    return (primary.data.id as string) || null;
  } catch {
    return null;
  }
}

/**
 * Build an OAuth2 client authenticated with a tenant's STORED (decrypted) tokens,
 * with the refresh wired in: when googleapis silently renews the access token it
 * emits "tokens", and we persist the new access token (+ any rotated refresh
 * token) back through the ENCRYPTED storage layer. Returns null if the tenant has
 * no usable connection. (Used by free-busy in a later sub-batch; the refresh hook
 * only fires on a real API call.)
 */
export async function makeAuthedClient(tenantId: string): Promise<OAuth2Client | null> {
  const conn = await getDecryptedConnection(tenantId);
  if (!conn || !conn.refreshToken) return null;
  const client = makeOAuth2Client();
  client.setCredentials({
    access_token: conn.accessToken ?? undefined,
    refresh_token: conn.refreshToken,
    expiry_date: conn.accessTokenExpiresAt ? conn.accessTokenExpiresAt.getTime() : undefined,
  });
  client.on("tokens", (t) => {
    // Persist asynchronously; never throw out of the event handler, never log tokens.
    void (async () => {
      try {
        if (t.access_token) {
          await updateAccessToken(tenantId, t.access_token, t.expiry_date ? new Date(t.expiry_date) : null);
        }
        if (t.refresh_token) {
          await upsertGoogleConnection(tenantId, { refreshToken: t.refresh_token });
        }
      } catch {
        /* swallow: a persistence hiccup must not break the in-flight API call */
      }
    })();
  });
  return client;
}
