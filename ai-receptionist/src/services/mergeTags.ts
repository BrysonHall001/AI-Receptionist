import { templateContext, loadFieldDefs, FieldMeta } from "../automation/contactRow";

// Merge tags personalize an email per recipient. Syntax: {{key}} or {{key|fallback}}.
// Keys are STABLE field keys (the same keys the field system / exports use). The
// fallback (after the pipe) is used when the recipient has no value for that field.
//
// This is the SINGLE resolver for the whole app — every send path (email blast,
// survey blast, invite custom email, automation email) runs strings through it so a
// raw "{{...}}" can never reach a recipient and an empty value never leaves "Hi ,".
export const MERGE_TAG_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Replace every {{key}} / {{key|fallback}} in `text` using `values`:
 *   value present & non-empty -> the value
 *   else fallback (if the tag supplied one) -> the fallback
 *   else "" -> the tag is omitted cleanly.
 * A raw token is NEVER left behind.
 */
export function resolveMergeTags(text: string, values: Record<string, string> | null | undefined): string {
  if (!text) return text;
  return String(text).replace(MERGE_TAG_RE, (_m, key, fallback) => {
    const v = values ? values[key] : undefined;
    if (v != null && String(v).trim() !== "") return String(v);
    return fallback != null ? fallback : "";
  });
}

/** True if a string contains at least one merge tag. */
export function hasMergeTags(text: string | null | undefined): boolean {
  if (!text) return false;
  const re = new RegExp(MERGE_TAG_RE.source, "g");
  return re.test(String(text));
}

/**
 * Per-recipient value map for a CONTACT: system keys (name/phone/email/intent/source),
 * derived first_name/last_name, and every custom contact field — by stable key. Reuses
 * templateContext (the exact field resolution automations already use), then layers the
 * derived name parts on top.
 */
export function contactMergeValues(contact: any, customFields: FieldMeta[]): Record<string, string> {
  const ctx = templateContext(contact || {}, customFields || []);
  const name = String(ctx.name || (contact && contact.name) || "").trim();
  const parts = name ? name.split(/\s+/) : [];
  if (!ctx.first_name) ctx.first_name = parts[0] || "";
  if (!ctx.last_name) ctx.last_name = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return ctx;
}

/** Load contact field defs once and return a resolver bound to them (for fan-outs). */
export async function contactMergeResolver(tenantId: string) {
  const customFields = await loadFieldDefs(tenantId);
  return {
    customFields,
    /** Resolve subject+body for one contact (or null/typed addr -> fallbacks only). */
    apply: (text: string, contact: any) => resolveMergeTags(text, contact ? contactMergeValues(contact, customFields) : {}),
  };
}

/**
 * The merge tags offered in the insert picker: system + derived first, then every
 * custom contact field. Friendly labels for display; stable keys under the hood.
 */
export function availableMergeTags(customFields: FieldMeta[]): Array<{ key: string; label: string }> {
  const tags = [
    { key: "first_name", label: "First name" },
    { key: "name", label: "Full name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
  ];
  const seen = new Set(tags.map((t) => t.key));
  for (const f of customFields || []) {
    if (f && f.key && !seen.has(f.key)) { tags.push({ key: f.key, label: f.label || f.key }); seen.add(f.key); }
  }
  return tags;
}
