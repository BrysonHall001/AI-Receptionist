// Central theme definitions + server-side sanitizers.
//
// SECURITY: nothing here turns user input into raw CSS. Presets are referenced
// by id only (styling is author-written CSS keyed by a data-theme attribute).
// Custom values are strictly validated: colors must be #rgb/#rrggbb hex, the
// font must be one of a fixed set of ids, and a theme NAME is treated as plain
// text (control chars / angle brackets stripped, length capped). Anything else
// is rejected and replaced with a safe default, so only known-good values can
// ever be stored.
import { randomBytes } from "crypto";

export type ThemeMode = "preset" | "custom";

// A custom palette. topbar + panel are explicit now (the designer exposes them).
export interface CustomTheme {
  background: string; // hex — page background
  fontColor: string; // hex — body text
  sidebar: string; // hex — left navigation background
  topbar: string; // hex — top bar background
  panel: string; // hex — content panels/cards
  font: string; // a FONT id from the allow-list
}

export interface NamedCustom extends CustomTheme {
  id: string; // charset-safe id, server-assigned
  name: string; // user-supplied text (sanitized)
}

// What we now store PER USER (User.themePrefs): the active selection plus any
// number of named custom palettes.
export interface UserTheme {
  active: { mode: "preset"; preset: string } | { mode: "custom"; customId: string };
  customs: NamedCustom[];
  // Fun-theme decoration intensity, integer 0..100 (0 = today's look). Applied
  // client-side via a --fun CSS variable; only fun presets react to it.
  funLevel?: number;
  // Optional per-portal white-label logo, stored as a PNG/JPEG data URL (same
  // base64-in-DB approach the custom-field image type uses). Absent = default branding.
  logo?: string | null;
  // Phase 9b.2 — Design-your-own COMPONENT STYLE sliders. Six optional 0..100 ints plus
  // an optional shadow-color hex; absent = the active preset's exaggerated personality.
  // Legacy 9b enum strings ("sharp"/"crisp"/…) are mapped to positions ON SAVE here and
  // on read in theme.js, so old saves load correctly forever; saves write the numeric
  // format. Overrides mirror the custom-color precedence exactly (client-side).
  corners?: number;
  shadows?: number;
  borders?: number;
  buttons?: number;
  navHighlight?: number;
  density?: number;
  shadowColor?: string;
  borderColor?: string; // revisions 1: the Border-color pick (hex; absent = the theme's --line)
}

// ---- Legacy per-portal shape (kept only to import old Tenant.theme data) ----
export interface Theme {
  mode: ThemeMode;
  preset?: string;
  custom?: { background: string; fontColor: string; sidebar: string; font: string };
}

// The shipped presets. Adding one = add an entry here AND a matching
// `body[data-theme="<id>"]` block in public/styles.css.
export const PRESETS = [
  { id: "light", label: "Classic Clarity", group: "basic", swatches: ["#fbfbfa", "#5b59d6", "#1a1a1e"] },
  { id: "warm", label: "Warm Light", group: "basic", swatches: ["#fbf8f3", "#5b59d6", "#2b2722"] },
  { id: "neutral", label: "Neutral Pro", group: "basic", swatches: ["#f5f6f7", "#2f6f8f", "#22282e"] },
  { id: "slate", label: "Slate", group: "basic", swatches: ["#eef1f4", "#4a6076", "#2b3440"] },
  { id: "steel", label: "Steel Blue", group: "basic", swatches: ["#f4f6f9", "#2a4d7a", "#1f2733"] },
  { id: "sand", label: "Sand", group: "basic", swatches: ["#f3ecdf", "#a9763e", "#43392b"] },
  { id: "contrast", label: "High Contrast", group: "basic", swatches: ["#ffffff", "#0b5bd3", "#000000"] },
  { id: "graphite", label: "Graphite", group: "basic", swatches: ["#2b2d31", "#8a88f0", "#e7e8ea"] },
  { id: "dark", label: "Dark", group: "basic", swatches: ["#15151a", "#8482f5", "#e9e9f0"] },
  { id: "midnight", label: "Midnight", group: "basic", swatches: ["#07070b", "#6f6df0", "#e6e7ee"] },
  { id: "aero", label: "Frutiger Aero", group: "fun", swatches: ["#7fd2ff", "#c9f5e6", "#0a8ed9"] },
  { id: "dusk", label: "Neon Dusk", group: "fun", swatches: ["#0f0c29", "#ff3df0", "#22e0ff"] },
  { id: "cottage", label: "Cottage Warm", group: "fun", swatches: ["#f4ecdd", "#7c9473", "#c8843c"] },
  { id: "vaporwave", label: "Vaporwave", group: "fun", swatches: ["#1a1130", "#ff6ad5", "#6be1ff"] },
  { id: "forest", label: "Deep Woods", group: "fun", swatches: ["#1c2a22", "#7fae6a", "#eef0e6"] },
  { id: "sunset", label: "Golden Hour", group: "fun", swatches: ["#f8c69a", "#e8743c", "#3a2a33"] },
  { id: "dreamcore", label: "Dreamcore", group: "fun", swatches: ["#f1e6fb", "#ff9ecf", "#43384e"] },
  { id: "academia", label: "Dark Academia", group: "fun", swatches: ["#241a12", "#c8a24a", "#ece0cf"] },
] as const;

export const PRESET_IDS: string[] = PRESETS.map((p) => p.id);

export const FONTS = [
  { id: "system", label: "System Sans" },
  { id: "rounded", label: "Rounded (Nunito)" },
  { id: "geometric", label: "Geometric (Poppins)" },
  { id: "humanist", label: "Humanist" },
  { id: "serif", label: "Serif (Georgia)" },
  { id: "mono", label: "Monospace" },
] as const;

export const FONT_IDS: string[] = FONTS.map((f) => f.id);

// Phase 9b.2 — the slider dimensions and the legacy 9b enum -> position mapping.
// (Mirrored in public/js/theme.js LEGACY_MAP; the self-test asserts they agree.)
export const PERSONALITY_SLIDER_KEYS = ["corners", "shadows", "borders", "buttons", "navHighlight", "density"] as const;
export const LEGACY_PERSONALITY_MAP: Record<string, Record<string, number>> = {
  corners: { sharp: 8, soft: 35, round: 85 },
  shadows: { crisp: 20, standard: 40, blended: 75 },
  borders: { hairline: 25, strong: 80 }, // hairline remapped 40 -> 25 (25 = the exact-1px ring position)
  buttons: { rect: 10, soft: 35, pill: 90 },
};
// Kept as an alias so older imports keep compiling (the enum sets live on as the legacy
// mapping's keys).
export const COMPONENT_KEYS = PERSONALITY_SLIDER_KEYS.slice(0, 4) as unknown as Array<"corners" | "shadows" | "borders" | "buttons">;

export const MAX_CUSTOMS = 24;
export const MAX_NAME_LEN = 40;

export const DEFAULT_CUSTOM: CustomTheme = {
  background: "#ffffff", fontColor: "#1a1a1e", sidebar: "#ffffff", topbar: "#ffffff", panel: "#ffffff", font: "system",
};
export const DEFAULT_USER_THEME: UserTheme = { active: { mode: "preset", preset: "light" }, customs: [] };

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ID_RE = /^[a-z0-9_-]{1,40}$/;

export function isValidHex(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v.trim());
}

// Clamp a proposed fun-intensity value to an integer 0..100. Non-numeric /
// non-finite input (incl. NaN, Infinity, objects, "abc") coerces safely to 0,
// so a bad value can never disable the "0 = unchanged" default.
export function clampFunLevel(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function genId(): string {
  return "c" + randomBytes(6).toString("hex");
}

// Theme NAME is plain text: strip control chars + angle brackets, cap length.
function sanitizeName(v: unknown): string {
  let s = typeof v === "string" ? v : "";
  s = s.replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
  if (s.length > MAX_NAME_LEN) s = s.slice(0, MAX_NAME_LEN);
  return s || "My theme";
}

function sanitizeCustomFields(o: any): CustomTheme {
  o = o || {};
  return {
    background: isValidHex(o.background) ? String(o.background).trim() : "#ffffff",
    fontColor: isValidHex(o.fontColor) ? String(o.fontColor).trim() : "#1a1a1e",
    sidebar: isValidHex(o.sidebar) ? String(o.sidebar).trim() : "#ffffff",
    topbar: isValidHex(o.topbar) ? String(o.topbar).trim() : "#ffffff",
    panel: isValidHex(o.panel) ? String(o.panel).trim() : "#ffffff",
    font: FONT_IDS.includes(o.font) ? String(o.font) : "system",
  };
}

/** Normalize an untrusted per-user theme. Never throws. */
export function sanitizeUserTheme(input: unknown): UserTheme {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, any>;

  const rawCustoms = Array.isArray(obj.customs) ? obj.customs.slice(0, MAX_CUSTOMS) : [];
  const seen = new Set<string>();
  const customs: NamedCustom[] = rawCustoms.map((rc: any) => {
    let id = typeof rc?.id === "string" && ID_RE.test(rc.id) ? rc.id : genId();
    while (seen.has(id)) id = genId();
    seen.add(id);
    return { id, name: sanitizeName(rc?.name), ...sanitizeCustomFields(rc) };
  });

  const a = (obj.active && typeof obj.active === "object" ? obj.active : {}) as Record<string, any>;
  let active: UserTheme["active"] = { mode: "preset", preset: "light" };
  if (a.mode === "custom" && typeof a.customId === "string" && customs.some((c) => c.id === a.customId)) {
    active = { mode: "custom", customId: a.customId };
  } else {
    active = { mode: "preset", preset: PRESET_IDS.includes(a.preset) ? String(a.preset) : "light" };
  }
  const logo = sanitizeLogo(obj.logo);
  const funLevel = clampFunLevel(obj.funLevel);
  const outBase: UserTheme = { active, customs, funLevel };
  // Phase 9b.2 personality sliders: ints clamped 0..100; legacy 9b enum strings map to
  // their positions ON SAVE (write the new format); anything else is dropped — absent
  // means "use the preset's personality", so legacy payloads without the fields
  // round-trip byte-identical and a bad value can never stick.
  for (const k of PERSONALITY_SLIDER_KEYS) {
    let v: unknown = obj[k];
    if (typeof v === "string" && LEGACY_PERSONALITY_MAP[k] && LEGACY_PERSONALITY_MAP[k][v] != null) v = LEGACY_PERSONALITY_MAP[k][v];
    const n = typeof v === "number" ? v : Number(v);
    if ((k in obj) && Number.isFinite(n)) (outBase as any)[k] = Math.max(0, Math.min(100, Math.round(n)));
  }
  if (isValidHex(obj.shadowColor)) (outBase as any).shadowColor = String(obj.shadowColor).trim();
  if (isValidHex(obj.borderColor)) (outBase as any).borderColor = String(obj.borderColor).trim();
  return logo ? { ...outBase, logo } : outBase;
}

// White-label logo guardrail (server-enforced): only a PNG or JPEG data URL,
// capped in size so a portal can't store something huge. Anything else -> dropped.
// ~500 KB of binary becomes ~685 KB of base64; 740000 chars leaves a little headroom.
const LOGO_MAX_CHARS = 740000;
function sanitizeLogo(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s)) return null;
  if (s.length > LOGO_MAX_CHARS) return null;
  return s;
}

// Parse a legacy Tenant.theme value (best-effort) so we can import it per-user.
export function sanitizeLegacyTheme(input: unknown): Theme {
  if (!input || typeof input !== "object") return { mode: "preset", preset: "light" };
  const o = input as Record<string, any>;
  const preset = PRESET_IDS.includes(o.preset) ? String(o.preset) : "light";
  if (o.mode === "custom" && o.custom && typeof o.custom === "object") {
    const c = o.custom;
    if (isValidHex(c.background) || isValidHex(c.fontColor) || isValidHex(c.sidebar)) {
      return {
        mode: "custom",
        preset,
        custom: {
          background: isValidHex(c.background) ? String(c.background).trim() : "#ffffff",
          fontColor: isValidHex(c.fontColor) ? String(c.fontColor).trim() : "#1a1a1e",
          sidebar: isValidHex(c.sidebar) ? String(c.sidebar).trim() : "#ffffff",
          font: FONT_IDS.includes(c.font) ? String(c.font) : "system",
        },
      };
    }
  }
  return { mode: "preset", preset };
}

// Convert a legacy per-portal theme into an initial per-user theme so a user
// who hasn't personalized yet still sees their portal's previous look.
export function legacyToUserTheme(t: Theme): UserTheme {
  if (t.mode === "custom" && t.custom) {
    const id = genId();
    return {
      active: { mode: "custom", customId: id },
      customs: [{ id, name: "Portal theme", ...DEFAULT_CUSTOM, background: t.custom.background, fontColor: t.custom.fontColor, sidebar: t.custom.sidebar, font: t.custom.font }],
    };
  }
  return { active: { mode: "preset", preset: t.preset || "light" }, customs: [] };
}
