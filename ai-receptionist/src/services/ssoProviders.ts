// SSO SIGN-IN PROVIDERS — Google and Microsoft, identity scopes only.
//
// SEPARATE CREDENTIALS FROM THE CALENDAR INTEGRATION, deliberately. GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET already exist for the tenant Calendar connection and are NOT reused
// here: a login mechanism and a tenant integration must not share a kill switch or a consent
// screen. Turning off Calendar must never turn off sign-in, and vice versa.
//
// CONFIG IS READ AT CALL TIME, not at boot — the same discipline as googleClient.ts — so the
// app boots and runs identically with none of these set, and a provider can be provisioned
// without a rebuild.
//
// NO TOKENS ARE PERSISTED ANYWHERE IN THIS FILE. We exchange the authorisation code, read the
// identity claims out of the ID token, and discard everything else. SSO recognises a
// returning person; it never acts on their behalf.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export type SsoProvider = "google" | "microsoft";

export interface SsoIdentity {
  provider: SsoProvider;
  /** The provider-scoped IMMUTABLE identifier. See subjectFor(). Never the email. */
  subject: string;
  /** VERIFIED email, lower-cased. A provider that cannot prove the address returns null. */
  email: string | null;
  /** Why the email was rejected, for an honest owner-facing message. */
  refusal?: string;
}

/** Google's login credentials — distinct from the Calendar integration's. */
function googleCfg() {
  return {
    clientId: process.env.SSO_GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.SSO_GOOGLE_CLIENT_SECRET || "",
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
  };
}
/** Microsoft's login credentials. */
function microsoftCfg() {
  return {
    clientId: process.env.SSO_MICROSOFT_CLIENT_ID || "",
    clientSecret: process.env.SSO_MICROSOFT_CLIENT_SECRET || "",
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
  };
}

export function isGoogleSsoConfigured(): boolean {
  const c = googleCfg();
  return !!(c.clientId && c.clientSecret);
}
export function isMicrosoftSsoConfigured(): boolean {
  const c = microsoftCfg();
  return !!(c.clientId && c.clientSecret);
}
export function isSsoConfigured(p: SsoProvider): boolean {
  return p === "google" ? isGoogleSsoConfigured() : isMicrosoftSsoConfigured();
}
/** The providers whose buttons the sign-in screen may render. Empty = today's screen. */
export function configuredSsoProviders(): SsoProvider[] {
  const out: SsoProvider[] = [];
  if (isGoogleSsoConfigured()) out.push("google");
  if (isMicrosoftSsoConfigured()) out.push("microsoft");
  return out;
}

export function ssoRedirectUri(p: SsoProvider): string {
  const base = (p === "google" ? googleCfg() : microsoftCfg()).appBaseUrl.replace(/\/+$/, "");
  return `${base}/api/auth/sso/${p}/callback`;
}

// Identity scopes ONLY. No calendar, no mail, no offline access — we never need a refresh
// token because we never act on the user's behalf.
const GOOGLE_SCOPES = ["openid", "email", "profile"];
const MICROSOFT_SCOPES = ["openid", "email", "profile"];

/**
 * MICROSOFT USES THE "organizations" AUTHORITY — WORK AND SCHOOL ACCOUNTS ONLY.
 *
 * Personal Microsoft accounts (outlook.com, hotmail.com, live.com) are refused, because
 * Microsoft cannot prove the address on them and an unverified email is exactly the input
 * that makes email-based account matching an account-takeover route. "common" would admit
 * them; "organizations" does not.
 */
const MICROSOFT_AUTHORITY = "organizations";

/**
 * THE SUBJECT IS THE IDENTITY. THE EMAIL IS A LABEL.
 *
 * Google: the ID token's `sub`, which is stable for the life of the account.
 *
 * Microsoft: `tid:oid` — the tenant id joined to the directory object id — because that is
 * Microsoft's own guidance. DO NOT "SIMPLIFY" THIS TO `oid` ALONE: oid is unique only within
 * a tenant, so two users in different tenants can share one. And do not use `sub`: Microsoft's
 * `sub` is pairwise per application, not a durable directory identifier.
 */
function subjectFor(provider: SsoProvider, claims: any): string | null {
  if (provider === "google") return typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  const tid = typeof claims.tid === "string" ? claims.tid : "";
  const oid = typeof claims.oid === "string" ? claims.oid : "";
  return tid && oid ? `${tid}:${oid}` : null;
}

/**
 * THE VERIFIED-EMAIL RULE, per provider. An address we cannot prove is refused outright —
 * never treated as a weaker match.
 *
 * Google: `email_verified` must be exactly true.
 *
 * Microsoft: THE ABSENCE OF AN EMAIL CLAIM IS ITSELF THE UNVERIFIED SIGNAL. Since June 2023
 * Microsoft omits the email claim entirely from newly registered applications when the
 * address is unverified, so we need no optional claim configured in Azure and we depend on
 * nothing that might be withdrawn. `xms_edov`, if present, is used only to CORROBORATE —
 * nothing here depends on it, because its future is publicly uncertain.
 *
 * ⚠️ NEVER SET authenticationBehaviors.removeUnverifiedEmailClaim TO false ON THE AZURE APP
 * REGISTRATION. It looks like a harmless compatibility toggle. It would reintroduce exactly
 * the unverified email claim Microsoft removed to close this hole, and this code would then
 * accept an address Microsoft has not proven.
 */
function verifiedEmailFrom(provider: SsoProvider, claims: any): { email: string | null; refusal?: string } {
  const raw = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (provider === "google") {
    if (!raw) return { email: null, refusal: "Google didn't share an email address for that account." };
    if (claims.email_verified !== true) return { email: null, refusal: "That Google address hasn't been verified with Google yet." };
    return { email: raw };
  }
  // Microsoft
  if (!raw) {
    return {
      email: null,
      refusal: "Personal Microsoft accounts aren't supported for signing in. Please use your work email address, Google, or your password.",
    };
  }
  if (claims.xms_edov === false) {
    return { email: null, refusal: "Microsoft hasn't verified that email address for that account." };
  }
  return { email: raw };
}

/** The provider's consent URL, with PKCE. */
export function ssoAuthorizeUrl(p: SsoProvider, state: string, codeChallenge: string): string {
  const cfg = p === "google" ? googleCfg() : microsoftCfg();
  const base = p === "google"
    ? "https://accounts.google.com/o/oauth2/v2/auth"
    : `https://login.microsoftonline.com/${MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize`;
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: ssoRedirectUri(p),
    response_type: "code",
    scope: (p === "google" ? GOOGLE_SCOPES : MICROSOFT_SCOPES).join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${base}?${q.toString()}`;
}

/** A PKCE pair. The verifier never leaves this server. */
export function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Read the claims out of an ID token WITHOUT trusting its signature for anything but shape. */
function claimsFromIdToken(idToken: string): any {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
}

/**
 * Exchange the authorisation code for an ID token and return the identity.
 *
 * The token endpoint is reached over TLS with our client secret, so the ID token arrives
 * directly from the provider rather than via the browser — which is why reading its claims
 * without separately verifying the signature is safe here. Nothing from this exchange is
 * stored: the access token is discarded the moment the claims are read.
 */
export async function exchangeSsoCode(p: SsoProvider, code: string, verifier: string): Promise<SsoIdentity | null> {
  const cfg = p === "google" ? googleCfg() : microsoftCfg();
  if (!cfg.clientId || !cfg.clientSecret) return null;
  const url = p === "google"
    ? "https://oauth2.googleapis.com/token"
    : `https://login.microsoftonline.com/${MICROSOFT_AUTHORITY}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: ssoRedirectUri(p),
    code_verifier: verifier,
  });
  let json: any = null;
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!r.ok) return null;
    json = await r.json();
  } catch { return null; }
  const claims = claimsFromIdToken(json && json.id_token);
  if (!claims) return null;
  const subject = subjectFor(p, claims);
  if (!subject) return null;
  const { email, refusal } = verifiedEmailFrom(p, claims);
  return { provider: p, subject, email, refusal };
}

// Exported for the self-test: the rules above are the security surface, and they are worth
// asserting directly rather than only through a live provider round trip.
export const __ssoInternals = { subjectFor, verifiedEmailFrom, claimsFromIdToken, MICROSOFT_AUTHORITY, GOOGLE_SCOPES, MICROSOFT_SCOPES };

// ---------------------------------------------------------------- state / CSRF / replay
export const SSO_STATE_COOKIE = "air_sso";
export const SSO_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function stateKey(): string { return process.env.SESSION_SECRET || process.env.APP_SECRET || "sso-state-dev-key"; }
export function signSsoState(payload: string): string {
  return createHmac("sha256", stateKey()).update(payload).digest("base64url");
}
/** Constant-time, so a mismatch leaks nothing through timing. */
export function sameSsoSig(a: string, b: string): boolean {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}
export function packSsoState(payload: string): string { return `${payload}.${signSsoState(payload)}`; }
/** Split a cookie value into its payload and verify the signature. */
export function openSsoState(raw: string): string | null {
  const v = String(raw || "");
  const i = v.lastIndexOf(".");
  if (i < 0) return null;
  const payload = v.slice(0, i), sig = v.slice(i + 1);
  return sameSsoSig(sig, signSsoState(payload)) ? payload : null;
}
/**
 * Verify a START-phase state cookie against the `state` the provider echoed back.
 * Refuses: a missing or malformed cookie, a tampered signature, the wrong provider, a nonce
 * that does not match, and anything older than the TTL. Single use is the caller's job -
 * the route clears the cookie before it does anything else, so a replay has nothing to
 * compare against.
 */
export function verifySsoStart(raw: string, provider: SsoProvider, echoedState: string, now = Date.now()):
  { ok: true; verifier: string } | { ok: false; why: string } {
  if (!raw) return { ok: false, why: "missing_state" };
  const payload = openSsoState(raw);
  if (payload === null) return { ok: false, why: "bad_signature" };
  const [p, nonce, tsRaw, verifier] = payload.split(".");
  if (p !== provider) return { ok: false, why: "provider_mismatch" };
  if (!echoedState || echoedState !== nonce) return { ok: false, why: "state_mismatch" };
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || now - ts > SSO_STATE_TTL_MS) return { ok: false, why: "expired_state" };
  if (!verifier) return { ok: false, why: "malformed_state" };
  return { ok: true, verifier };
}
