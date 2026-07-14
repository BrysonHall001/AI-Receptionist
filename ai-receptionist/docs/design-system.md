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

## Layout hardening — the primitives + defensive rules

Five anti-pattern classes cause every "row escapes its card" bug: (a) flex children without
`min-width: 0`; (b) action rows that neither wrap nor shrink; (c) fixed pixel widths inside
flexible containers; (d) unhandled long text in constrained cells; (e) grids without
`minmax(0, …)` floors. The fixes are systemic:

**Defensive base rules** — `.input`, `.search-input`, `.pop-input` carry `min-width: 0` so form
controls shrink inside flex rows; `.search-input` is confined to `max-width: 100%` of its
CONTAINER (never the viewport); long-text sites (`.user-name`, `.user-role`, `.widget-title`,
table `.cell-truncate`) ellipsize.

**The primitives** (use these instead of ad-hoc flex divs):
- `.toolbar` — filter/search/actions rows: wraps, children shrink, search-type inputs flex
  (`flex: 1 1 auto; min-width: 0`).
- `.actions-row` — button groups: gap + `flex-wrap: wrap`; children keep intrinsic size, the
  row never overflows.
- `.stack` / `.stack--tight` / `.stack--loose` — vertical, gaps on the spacing scale.
- `.split` — space-between with safe shrinking (`min-width: 0` down the chain).
- `.grow` — the flexible-child helper (`flex: 1 1 auto; min-width: 0`).

**Documented aliases** — these long-standing shared containers carry the same declarations in
place and count as the pattern: `.table-toolbar` (+ `.toolbar-left`/`.toolbar-right`/
`.filter-chips`), `.modal-foot`, `.user-actions`, `.cm-libheadrow`, `.portal-actions`,
`.intg-bar`, `.section-head`, `.rb-head`, `.reports-bar`, `.fields-section-head`.

**Judgment rule** — bespoke layout engines (calendar grid, kanban lanes, flow canvas, composer,
map) stay bespoke; primitives are for the repeated generic patterns only.

The five anti-patterns are counted by `designAudit.ts` and ratcheted like every other counter.

## Phase 9b.2 — personality sliders (revises 9b in place)

The 9b segmented enums became seven 0–100 sliders plus a shadow-color picker, all applied
live via `theme.js personalityTokens()` — ONE pure deterministic positions→tokens map — with
9b's exact precedence (custom fields override the active preset's positions; "Reset to theme
default" restores them). Legacy 9b enum saves map on read (`sharp→8 / soft→35 / round→85`;
`crisp→20 / standard→40 / blended→75`; `hairline→40 / strong→80`; `rect→10 / soft→35 /
pill→90`); saves write the numeric format.

### The formulas (all lerps linear; px rounded)

- **Corners** — `--radius = lerp(0px, 28px, t)`; `--radius-sm = 0.7×` (0.85× at ≥90 so
  controls go bubble). Default **35** → 10px/7px (today, exactly).
- **Buttons** — `--btn-radius = lerp(2px, 24px, t)`, snapping to **999px at ≥85**;
  `--btn-pad-x = lerp(12px, 20px, t)`. Default **23** → 7px/14px — the spec's 35 would give
  10px/15px, a visible change, so the default is the position that reproduces today.
- **Shadows** — keyframed dual-layer interpolation with exact anchors (light track):
  `0=off`, `25 = 0 1px 2px α.10`, `40 = the 9a standard verbatim`, `70 = 0 8px 30px α.10 +
  0 2px 10px α.06`, `100 = 0 24px 80px α.20 + 0 6px 30px α.12` (lg: 6/24·.14 → 10/40·.16 →
  18/60·.16 → 32/110·.26). Dark track anchors derive from black per the Dark-preset
  precedent (40 = the Dark preset's exact values).
- **Shadow color** — the picked hex replaces the neutral base (`rgb(20,20,30)` light /
  black dark) at the slider's current alphas. Neutral = today.
- **Borders** — bands: 0–19 borderless cards (`--card-border: transparent`, controls
  `--line`); 20–59 today (`--line` cards / `--line-strong` controls, 1px); 60–89 both
  `--line-strong`; 90–100 the 2px silly end. **Zero-zero floor:** borders 0 + shadows 0
  forces a 1px `--line` card hairline so surfaces never vanish.
- **Nav highlight** — five bands styling `.nav-item.active` (sidebar AND the top page-nav
  row) via `--nav-active-bg/-ink/-bar/-glow`; band starts extend the previous band's end
  state (bar lerps 0→3px across 40–59; bg color-mixes toward `--accent` across 60–79 with
  the ink flipping at the 50% mix; glow radius lerps 0→18px across 80–100). Default **40**
  = soft pill + 0px bar = today exactly. The bar renders as a left border on sidebar items
  and an underline on top tabs.
- **Table density** — `--table-row-pad = lerp(4px, 18px, t)`; `--list-row-pad =
  clamp(round(pad × 8/13), 3, 12)` nudges the shared list rows. Default **64** → 13px/8px
  (today, including the test-pinned 13px; the spec's 40 would give 10px).

Preset personalities now live in `theme.js PRESET_PERSONALITIES` as slider positions
(single source; the 9b CSS token bundles were removed from the theme blocks). Fun intensity
still means scenic strength only. Pills/badges stay 999px; the eyebrow/type system is
untouched.
