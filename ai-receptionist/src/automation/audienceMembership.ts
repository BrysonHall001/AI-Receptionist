// Attach a contact's current audience memberships to the row before condition evaluation, so
// "contact is in Audience X" conditions (field __audience, ops in_audience/not_in_audience) resolve
// against the audience's CURRENT definition — the same evalRules mechanism, nothing precomputed or
// stored. Only the audiences a rule set actually references are resolved, and each is resolved once
// per call via the provided cache.
import { resolveAudienceContacts } from "../services/audienceService";
import { AUDIENCE_FIELD_KEY } from "./contactRow";
import type { Rule } from "./conditions";

export type MembershipCache = Map<string, Set<string>>;

/** Distinct audience ids referenced by audience-membership rules in a condition set. */
export function audienceIdsInRules(rules: Rule[] | undefined | null): string[] {
  const out = new Set<string>();
  for (const r of rules || []) {
    if (r && r.field === AUDIENCE_FIELD_KEY && (r.op === "in_audience" || r.op === "not_in_audience") && r.value) out.add(String(r.value));
  }
  return Array.from(out);
}

/** The set of contact ids currently in an audience (memoized in `cache`). Missing audience -> empty. */
async function memberSet(tenantId: string, audienceId: string, cache: MembershipCache): Promise<Set<string>> {
  const key = tenantId + ":" + audienceId;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = await resolveAudienceContacts(tenantId, audienceId);
  const set = new Set<string>((rows || []).map((r) => r.id));
  cache.set(key, set);
  return set;
}

/** Set contact.__audienceIds to the subset of referenced audiences this contact belongs to. No-op
 *  when the rules reference no audiences. Mutates the row in place. */
export async function attachAudienceMembership(tenantId: string, contact: any, rules: Rule[] | undefined | null, cache?: MembershipCache): Promise<void> {
  const ids = audienceIdsInRules(rules);
  if (!ids.length) { if (contact && !contact.__audienceIds) contact.__audienceIds = []; return; }
  const c = cache || new Map();
  const inThese: string[] = [];
  for (const aid of ids) { const set = await memberSet(tenantId, aid, c); if (set.has(contact.id)) inThese.push(aid); }
  contact.__audienceIds = inThese;
}
