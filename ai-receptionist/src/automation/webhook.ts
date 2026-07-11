import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { URL } from "node:url";
import { FieldMeta, conditionFields, valueOf } from "./contactRow";

// ===========================================================================
// Outbound webhook with SSRF protection.
//
// SSRF (Server-Side Request Forgery) = tricking our server into calling an
// address it shouldn't, usually something INTERNAL (our own DB, the local
// network, or a cloud "metadata" endpoint that can leak credentials). Defenses:
//   1. allow only http/https,
//   2. resolve the hostname's real IP(s) and reject any private/loopback/
//      link-local/reserved address (so a public-looking domain that secretly
//      points inward is caught), and
//   3. PIN the connection to the validated IP via a guarded DNS lookup, so the
//      address can't change between our check and the actual connect.
// Redirects are not followed (a 30x could otherwise bounce us internal).
// ===========================================================================

// ---- IP classification ----------------------------------------------------
function ipv4Blocked(ip: string): string | null {
  const p = ip.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => isNaN(n) || n < 0 || n > 255)) return "malformed IPv4";
  const [a, b] = p;
  if (a === 0) return "unspecified (0.0.0.0/8)";
  if (a === 10) return "private network (10.0.0.0/8)";
  if (a === 127) return "loopback (127.0.0.0/8)";
  if (a === 169 && b === 254) return "link-local / cloud metadata (169.254.0.0/16)";
  if (a === 172 && b >= 16 && b <= 31) return "private network (172.16.0.0/12)";
  if (a === 192 && b === 168) return "private network (192.168.0.0/16)";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT (100.64.0.0/10)";
  if (a >= 224) return "multicast/reserved (>= 224.0.0.0)";
  return null;
}

function ipv6Blocked(ip: string): string | null {
  const s = ip.toLowerCase();
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) return ipv4Blocked(mapped[1]);
  if (s === "::1") return "IPv6 loopback (::1)";
  if (s === "::") return "IPv6 unspecified (::)";
  if (s.startsWith("fc") || s.startsWith("fd")) return "IPv6 unique-local (fc00::/7)";
  if (/^fe[89ab]/.test(s)) return "IPv6 link-local (fe80::/10)";
  if (s.startsWith("ff")) return "IPv6 multicast (ff00::/8)";
  return null;
}

function blockedIpReason(ip: string): string | null {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Blocked(ip);
  if (v === 6) return ipv6Blocked(ip);
  return "not a recognizable IP address";
}

export interface UrlCheck { ok: boolean; reason?: string; host?: string; warnHttp?: boolean; }

// Friendly pre-check (used by the UI test + before sending): scheme + resolve
// all addresses + reject any private one. Returns warnHttp for http URLs.
export async function validateWebhookUrl(raw: string): Promise<UrlCheck> {
  let url: URL;
  try { url = new URL(String(raw || "").trim()); } catch { return { ok: false, reason: "Not a valid URL" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http/https URLs are allowed" };
  let host = url.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1); // IPv6 literal
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower === "metadata.google.internal") {
    return { ok: false, reason: "Internal/loopback host is blocked", host };
  }
  let ips: string[] = [];
  if (net.isIP(host)) ips = [host];
  else {
    try { const res = await dnsLookup(host, { all: true }); ips = res.map((r) => r.address); }
    catch { return { ok: false, reason: "Could not resolve host", host }; }
  }
  if (!ips.length) return { ok: false, reason: "Host did not resolve", host };
  for (const ip of ips) { const r = blockedIpReason(ip); if (r) return { ok: false, reason: `Resolves to a blocked address: ${r}`, host }; }
  return { ok: true, host, warnHttp: url.protocol === "http:" };
}

// Connection-time guard: resolve, reject blocked IPs, and hand the socket ONLY
// the validated address (pins the connection — closes the check/connect gap).
function guardedLookup(hostname: string, options: any, callback?: any) {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options || {};
  dns.lookup(hostname, { all: true, family: opts.family, hints: opts.hints }, (err, addresses: any) => {
    if (err) return cb(err);
    const arr = Array.isArray(addresses) ? addresses : [{ address: addresses, family: opts.family || 4 }];
    for (const a of arr) { const r = blockedIpReason(a.address); if (r) { const e: any = new Error("Blocked destination: " + r); e.code = "EBLOCKED"; return cb(e); } }
    if (opts.all) return cb(null, arr);
    return cb(null, arr[0].address, arr[0].family);
  });
}

export interface SendResult { outcome: "sent" | "timeout" | "error" | "blocked"; status?: number; ok?: boolean; error?: string; reason?: string; }

// Outbound POST. Short timeout (flow never hangs), no redirect following, and
// the optional secret header goes on the wire but is NEVER returned/logged.
export function sendWebhook(opts: {
  url: string;
  headerName?: string | null;
  headerValue?: string | null;
  payload: any;
  timeoutMs?: number;
}): Promise<SendResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  let url: URL;
  try { url = new URL(String(opts.url || "").trim()); } catch { return Promise.resolve({ outcome: "blocked", reason: "Not a valid URL" }); }
  if (url.protocol !== "http:" && url.protocol !== "https:") return Promise.resolve({ outcome: "blocked", reason: "Only http/https URLs are allowed" });

  const body = Buffer.from(JSON.stringify(opts.payload ?? {}));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-length": String(body.length),
    "user-agent": "ClarityCRM-Webhook/1.0",
  };
  if (opts.headerName && String(opts.headerName).trim() && opts.headerValue != null && String(opts.headerValue) !== "") {
    headers[String(opts.headerName).trim()] = String(opts.headerValue);
  }

  const lib = url.protocol === "https:" ? https : http;
  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const done = (r: SendResult) => { if (!settled) { settled = true; resolve(r); } };
    let req: http.ClientRequest;
    try {
      req = lib.request(url, { method: "POST", headers, timeout: timeoutMs, lookup: guardedLookup as any }, (res) => {
        res.on("data", () => {}); // drain & discard; we only need the status
        res.on("end", () => {
          const status = res.statusCode || 0;
          done({ outcome: "sent", status, ok: status >= 200 && status < 300 });
        });
      });
    } catch (e) {
      return done({ outcome: "blocked", reason: (e as Error).message });
    }
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (err: any) => {
      if (err && err.code === "EBLOCKED") done({ outcome: "blocked", reason: err.message.replace(/^Blocked destination: /, "") });
      else if (err && err.code === "ETIMEDOUT") done({ outcome: "timeout" });
      else done({ outcome: "error", error: err?.message || String(err) });
    });
    req.write(body);
    req.end();
  });
}

// ---- payloads (only the tenant's own modeled fields) ----------------------
export function buildContactPayload(contact: any, fieldDefs: FieldMeta[]) {
  const fields: Record<string, any> = {};
  conditionFields(fieldDefs).forEach((f) => { fields[f.key] = valueOf(contact, f.key) ?? null; });
  return { id: contact.id, fields };
}

function sampleFor(f: FieldMeta): any {
  switch (f.type) {
    case "date": return "2025-01-01";
    case "number": case "percent": case "currency": return 42;
    case "checkbox": return true;
    case "multi_select": return ["Sample"];
    default: return `Sample ${f.label}`;
  }
}

export function buildSamplePayload(tenantId: string, fieldDefs: FieldMeta[]) {
  const fields: Record<string, any> = {};
  conditionFields(fieldDefs).forEach((f) => { fields[f.key] = sampleFor(f); });
  return {
    source: "ClarityCRM",
    event: { tenantId, automationName: "(test)", trigger: "test", occurredAt: new Date().toISOString(), test: true },
    contact: { id: "sample_contact", fields },
  };
}
