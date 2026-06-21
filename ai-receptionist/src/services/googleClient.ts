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

/** Distinguishes "couldn't reach Google / connection needs reconnecting" from a
 *  genuine empty calendar list. The route turns this into a clean, clear error
 *  (never a 500, never a silent empty list). */
export class GoogleNotReachableError extends Error {
  readonly needsReconnect = true;
  constructor(message = "Google connection needs reconnecting") {
    super(message);
    this.name = "GoogleNotReachableError";
  }
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
}

/**
 * List the calendars the connected account can see. READ-ONLY (calendarList.list).
 * Returns ONLY {id, summary, primary} — never tokens. Throws GoogleNotReachableError
 * when there's no usable connection or the Google call fails (e.g. revoked token),
 * so the caller can tell that apart from a real (but empty) list. This is the first
 * live Google API call, so it also exercises makeAuthedClient's auto-refresh.
 */
export async function listCalendars(tenantId: string): Promise<CalendarListEntry[]> {
  const client = await makeAuthedClient(tenantId);
  if (!client) throw new GoogleNotReachableError();
  try {
    const cal = google.calendar({ version: "v3", auth: client });
    const out: CalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const resp = await cal.calendarList.list({ maxResults: 250, pageToken, showHidden: false });
      for (const item of resp.data.items || []) {
        if (!item.id) continue;
        out.push({
          id: item.id,
          summary: (item.summaryOverride || item.summary || item.id) as string,
          primary: !!item.primary,
        });
      }
      pageToken = resp.data.nextPageToken || undefined;
    } while (pageToken);
    // Primary first, then alphabetical — stable, readable order for the dropdown.
    out.sort((a, b) => (a.primary === b.primary ? a.summary.localeCompare(b.summary) : a.primary ? -1 : 1));
    return out;
  } catch {
    // Revoked/expired refresh, auth error, or network failure. Never log tokens.
    throw new GoogleNotReachableError();
  }
}

// ---- Debug free/busy (sub-batch 4: raw proof only; NOT wired into availability) ----

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate + normalize the debug window. Accepts a bare date (YYYY-MM-DD, treated
 * as UTC midnight) or a full RFC3339 instant; returns the literal strings to hand
 * to Google's free/busy (NOT reformatted through Date — we never mangle the window
 * through a timezone). Pure + sandbox-testable. Throws on invalid input.
 */
export function normalizeFreeBusyWindow(from?: string | null, to?: string | null): { fromISO: string; toISO: string } {
  const norm = (v: string | null | undefined, label: string): string => {
    const s = String(v ?? "").trim();
    if (!s) throw new Error(`"${label}" is required (a date YYYY-MM-DD or an RFC3339 instant)`);
    const iso = DATE_ONLY.test(s) ? `${s}T00:00:00Z` : s;
    if (Number.isNaN(new Date(iso).getTime())) throw new Error(`"${label}" is not a valid date/time: ${s}`);
    return iso;
  };
  const fromISO = norm(from, "from");
  const toISO = norm(to, "to");
  if (new Date(toISO).getTime() <= new Date(fromISO).getTime()) throw new Error(`"to" must be after "from"`);
  return { fromISO, toISO };
}

export interface FreeBusyRaw {
  calendarId: string;
  busy: Array<{ start?: string | null; end?: string | null }>; // RAW from Google, untouched
  googleErrors: Array<{ domain?: string | null; reason?: string | null }>;
}

/**
 * Call Google's free/busy for ONE calendar over [fromISO, toISO). Returns the RAW
 * busy intervals exactly as Google sends them (real tz-aware instants — NO
 * conversion, NO reshaping). Throws GoogleNotReachableError when there's no usable
 * connection or the call fails/refresh fails. `timeoutMs` fails a slow call fast.
 */
export async function freeBusyForCalendar(
  tenantId: string,
  calendarId: string,
  fromISO: string,
  toISO: string,
  timeoutMs = 10000,
): Promise<FreeBusyRaw> {
  const client = await makeAuthedClient(tenantId);
  if (!client) throw new GoogleNotReachableError();
  try {
    const cal = google.calendar({ version: "v3", auth: client });
    const resp = await cal.freebusy.query(
      { requestBody: { timeMin: fromISO, timeMax: toISO, items: [{ id: calendarId }] } },
      { timeout: timeoutMs },
    );
    const calData = (resp.data.calendars || {})[calendarId] || {};
    return {
      calendarId,
      busy: (calData.busy as FreeBusyRaw["busy"]) || [],
      googleErrors: (calData.errors as FreeBusyRaw["googleErrors"]) || [],
    };
  } catch {
    // Revoked/expired refresh, auth error, timeout, or network failure. No token logged.
    throw new GoogleNotReachableError();
  }
}
