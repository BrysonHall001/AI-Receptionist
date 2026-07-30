// SSO SIGN-IN DECISIONS — the security rules, in one place, independent of HTTP.
//
// The routes do transport (cookies, redirects, rate limiters); THIS decides who may sign in.
// Keeping them apart is deliberate: the rules below are the part worth asserting directly,
// and a rule that can only be exercised through a redirect chain tends not to be.
//
// SSO ADDS A WAY TO PROVE AN EXISTING IDENTITY. It never creates an account, never grants
// anything a password would not, and never skips a check the password path applies.
import { prisma } from "../db/client";
import { accountInactive } from "../services/userService";
import type { SsoIdentity, SsoProvider } from "./ssoProviders";

export type SsoOutcome =
  /** Sign them in. `userId` is the account the SUBJECT resolved to. */
  | { kind: "sign_in"; userId: string; user: any }
  /** Verified email matches an unlinked account: ask for that account's password, once. */
  | { kind: "needs_link"; email: string; provider: SsoProvider; subject: string }
  /** Refused. `reason` is owner-facing; `code` is for the audit row. */
  | { kind: "refused"; code: string; reason: string };

/**
 * THE MATCHING RULE. Subject first, always — the email is a label, not the identity.
 *
 * 1. SUBJECT KNOWN -> that is the user, even if their address has since changed at the
 *    provider. We refresh the stored email for display and sign them in.
 *
 * 2. SUBJECT UNKNOWN, email matches an account with no link for this provider -> the
 *    one-time password confirmation. No session is issued here.
 *
 * 3. SUBJECT UNKNOWN, email matches an account that ALREADY has a link for this provider
 *    with a DIFFERENT subject -> REFUSED OUTRIGHT. No password prompt, no re-link.
 *
 *    Case 3 is the account-takeover case and the most important decision in this batch.
 *    Offering the password prompt here would make a stolen password sufficient to re-point
 *    an existing link at an attacker's provider account - which is precisely what linking
 *    exists to prevent. The recovery path is deliberate and human: unlink from Settings ->
 *    Your account, then link again. Do not "improve" this into a password challenge.
 *
 * 4. No account for that address -> refused, and NOTHING IS CREATED. Users arrive by
 *    invitation; a stranger with a provider account must not become a user.
 */
export async function resolveSsoSignIn(identity: SsoIdentity): Promise<SsoOutcome> {
  // An address the provider could not prove never reaches a lookup.
  if (!identity.email) {
    return { kind: "refused", code: "unverified_email", reason: identity.refusal || "That account's email address could not be verified." };
  }
  const email = identity.email.trim().toLowerCase();

  // (1) subject first
  const link = await (prisma as any).userSsoLink.findUnique({
    where: { provider_subject: { provider: identity.provider, subject: identity.subject } },
  });
  if (link) {
    const user = await prisma.user.findUnique({ where: { id: link.userId } });
    if (!user) return { kind: "refused", code: "no_account", reason: "There's no account for that address." };
    // THE SAME GATE THE PASSWORD PATH APPLIES, at the same point: after identity is proven,
    // before any session exists. accountInactive() covers BOTH disabled and expired.
    if (accountInactive(user as any)) return { kind: "refused", code: "inactive", reason: "This account has expired." };
    // the address may have changed at the provider; the subject is what identified them
    if (link.email !== email) {
      await (prisma as any).userSsoLink.update({ where: { id: link.id }, data: { email } }).catch(() => { /* display only */ });
    }
    return { kind: "sign_in", userId: user.id, user };
  }

  // (4) no account -> nothing is created, and we say so plainly
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (!byEmail) return { kind: "refused", code: "no_account", reason: "There's no account for that address." };

  // (3) the takeover case: this address is already linked to a DIFFERENT provider identity
  const existingForUser = await (prisma as any).userSsoLink.findUnique({
    where: { userId_provider: { userId: byEmail.id, provider: identity.provider } },
  });
  if (existingForUser && existingForUser.subject !== identity.subject) {
    return {
      kind: "refused",
      code: "subject_mismatch",
      reason: "That address is already linked to a different account with this provider. Sign in with your password, then unlink it under Settings before linking a new one.",
    };
  }

  // An inactive account is refused BEFORE we invite a password attempt, so SSO can never be
  // used to probe whether a disabled account's password is right.
  if (accountInactive(byEmail as any)) return { kind: "refused", code: "inactive", reason: "This account has expired." };

  // (2) matching but unlinked -> confirm with the password, once
  return { kind: "needs_link", email, provider: identity.provider, subject: identity.subject };
}

/** Store the link. Only ever called AFTER the account's own password has been verified. */
export async function createSsoLink(userId: string, provider: SsoProvider, subject: string, email: string) {
  return (prisma as any).userSsoLink.create({ data: { userId, provider, subject, email: email.trim().toLowerCase() } });
}

/** Remove a link. Cannot lock anyone out: every account keeps its password. */
export async function removeSsoLink(userId: string, provider: SsoProvider): Promise<boolean> {
  const r = await (prisma as any).userSsoLink.deleteMany({ where: { userId, provider } });
  return (r?.count || 0) > 0;
}

/** The providers this user has linked, for Settings -> Your account. */
export async function listSsoLinks(userId: string) {
  return (prisma as any).userSsoLink.findMany({ where: { userId }, select: { provider: true, email: true, linkedAt: true } });
}
