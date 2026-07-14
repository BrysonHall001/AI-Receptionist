# Clarity design system — the canon

One page. This is the reference for every visual decision from Phase 0 onward. The rule in one
line: **new code uses tokens and classes, never raw values; the ratchet enforces it.**

## Where the canon lives

Everything is a CSS custom property in the `:root` block at the top of `public/styles.css`.
Theme presets (the `THEMES` section, `body[data-theme="…"]`) and per-tenant Appearance
customization (`public/js/theme.js`, via `style.setProperty`) override those same tokens.
That plumbing is the load-bearing wall: **extend it, never bypass it.** If a component needs a
new knob, it becomes a token that defaults to an existing token.

## Type scale (7 steps, 12px floor, compact-leaning)

| Token | Value | Use for |
|---|---|---|
| `--text-xs` | 12px | fine print, badges, table meta |
| `--text-sm` | 13px | secondary text, hints, dense tables |
| `--text-base` | 14px | body text, controls, most UI |
| `--text-md` | 16px | emphasized body, modal titles |
| `--text-lg` | 18px | section headings |
| `--text-xl` | 22px | page titles |
| `--text-2xl` | 28px | hero numbers, dashboards |

These are starting values chosen to match the app's current compact feel — adjustable **before**
surface migration begins; changing one later means re-testing every migrated surface.

## Spacing scale (4px base)

`--sp-1: 4px`, `--sp-2: 8px`, `--sp-3: 12px`, `--sp-4: 16px`, `--sp-5: 20px`, `--sp-6: 24px`,
`--sp-7: 32px`, `--sp-8: 48px`. Padding, margins, and gaps should land on this scale.
(`distinctSpacingValues` in the audit is informational for now; it becomes a ratchet once the
big surfaces are migrated.)

## Semantic colors — when to use which

- `--ink` / `--ink-soft` / `--ink-faint`: primary text / secondary text / hints & disabled.
- `--panel` / `--panel-2` / `--bg`: card surfaces / subtle inset surfaces / the page behind.
- `--line` / `--line-strong`: hairline separators / interactive control borders.
- `--accent` (+ `-soft`, `-strong`, `--on-accent`): the brand action color — buttons, links,
  active states. `-soft` for tinted backgrounds, `-strong` for hover/pressed.
- `--green` / `--amber` / `--red` (+ `-soft`s): success / caution / danger — status only,
  never decoration.
- Never introduce a raw hex outside the `:root` and `THEMES` blocks. If no semantic token
  fits, the fix is a new token with a documented meaning, not a hex.

## Component indirection layer

`--btn-radius`, `--btn-weight`, `--control-bg`, `--control-border`, `--card-radius`,
`--card-shadow`, `--table-row-pad` — components read these; each defaults to a base token
(e.g. `--btn-radius: var(--radius-sm)`). Today that's a no-op by construction. Tomorrow, an
Appearance "button style: pill" preset is just a token bundle setting `--btn-radius: 999px` —
zero component edits, and it composes with themes exactly like every existing token.

## The migration rule + the ratchet

- **New or edited code** uses scale tokens and shared classes. No raw hexes, no off-scale
  `font-size`, no new inline styles (`style.cssText`, `.style.prop =`, `style="` in built HTML).
- `src/db/designAudit.ts` measures violations per file; `src/db/designBaseline.json` is the
  committed high-water mark; `src/db/selfTest_designRatchet.ts` fails any batch that raises any
  count. When a migration batch lowers real counts, re-run
  `npx tsx src/db/designAudit.ts --write-baseline` and commit the lower baseline — lowering is
  always manual and deliberate.

## Exemptions

- `public/js/vendor/**` — third-party dists, exempt from everything.
- The `:root` token block and the `THEMES` preset blocks in `styles.css` — the two legitimate
  homes of raw color values.
- `public/js/theme.js` — its whole job is color plumbing (hex validation, luminance math,
  `setProperty` on tokens); `setProperty` on tokens is the sanctioned styling mechanism and is
  never counted as an inline style.

## Phase 9b — theme component personalities

Each theme preset carries a **personality bundle**: component-level token overrides along four
dimensions, expressed inside its existing `body[data-theme="…"]` block (same override mechanism
as its palette). The base `:root` values ARE the `soft / standard / hairline / soft` personality,
so Clean Light (`""`) needs no overrides and stays pixel-identical.

### The four dimensions — canonical token values

**Corners** (sets `--radius` / `--radius-sm`; `--btn-radius` and `--card-radius` follow via the
indirection layer unless the Buttons dimension overrides `--btn-radius`):
- `sharp` — `--radius: 3px; --radius-sm: 2px`
- `soft` — the base (`10px` / `7px`)
- `round` — `--radius: 16px; --radius-sm: 12px` (buttons ride `--radius-sm` = 12px unless Buttons=pill)
- `--modal-radius: calc(var(--radius) + 4px)` — modals follow corners automatically (base = the same 14px).

**Shadows** (sets `--shadow` / `--shadow-lg`; `--card-shadow` follows). Light themes derive
alphas from the ink-family `rgba(20,20,30,…)`; **dark themes derive from black**, per the
original Dark preset's precedent:
- `crisp` (hairline-dominant, lean on borders) — light: `0 1px 2px rgba(20,20,30,0.10)` /
  lg `0 6px 24px rgba(20,20,30,0.14)`; dark: `0 1px 2px rgba(0,0,0,0.45)` / lg `0 6px 24px rgba(0,0,0,0.55)`
- `standard` — the 9a base (dark presets keep their existing black-derived standard; Cottage keeps
  its warm-tinted standard — palette-derived alphas are the sanctioned variation)
- `blended` (large-blur, low-alpha, dual-layer, airy) — light: `0 8px 30px rgba(20,20,30,0.10),
  0 2px 10px rgba(20,20,30,0.06)` / lg `0 18px 60px rgba(20,20,30,0.16)`; dark: `0 8px 30px
  rgba(0,0,0,0.35), 0 2px 10px rgba(0,0,0,0.25)` / lg `0 18px 60px rgba(0,0,0,0.5)`

**Borders** (sets `--card-border` + `--card-border-w`; controls already read `--control-border`):
- `hairline` — the base: cards on `--line`, 1px
- `strong` — `--card-border: var(--line-strong)` (the Dusk precedent, generalized), plus the
  strong themes' tables take `--line-strong` on the header band + row rules (one grouped rule).
- **No 2px borders anywhere** — High Contrast's old 2px card/input borders converged onto the
  1px-at-black strong bundle.

**Buttons** (sets `--btn-radius` / `--btn-weight` / `--btn-pad-x`):
- `rect` — `4px / 600 / 14px`
- `soft` — the base (`--btn-radius: var(--radius-sm)` / `650` / `14px`)
- `pill` — `999px / 600 / 18px` (extra x-pad so pills don't look pinched)

### Minted tokens

`--card-border-w` (card-family border width, always 1px), `--btn-pad-x` (button horizontal
padding), plus `--card-border` — the card-family border *color* channel, needed to generalize
the Dusk strong-border precedent at token level (`.card`, `.stat-card`, `.portal-card`,
`.widget-card` all read it).

### Exemptions (personality-independent)

- **Pills / badges / stat-pill end caps stay `999px` ALWAYS** — status chips don't sharpen.
- **The eyebrow / type system never changes** with personality.
- Tables take **borders only, never shadows**.
- Scenic renderers and per-theme flourishes (Dusk glows/text-shadows, Aero gloss, Vaporwave's
  neon card ring) sit untouched **on top of** the bundles.

### Fun intensity

Personalities do **not** scale with the Fun intensity slider. Intensity keeps meaning
scenic/effect strength only; corners/shadows/borders/buttons are fixed per theme (or per the
user's Design-your-own component choices).
