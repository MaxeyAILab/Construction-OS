# ConstructionOS — UI Design System (`ui-design-system.md`)

> **Document type:** Design system specification
> **Status:** Draft v1.0
> **Traces to:** `spec.md` (§3.5 elegance, NFR-18–21), `architecture.md` (§5–6)
> **Inspiration studied, not copied:** Apple (restraint, materiality), Linear (speed, density, keyboard), Notion (calm content surfaces), Stripe (data clarity, docs-grade polish), Framer/Arc (motion personality), Tesla (confident minimalism)
> **Implementation targets:** Tailwind CSS v4 tokens + Radix primitives (web), NativeWind (mobile)

---

## 1. Design Philosophy

1. **Calm authority.** Construction is chaotic; the software must feel like the calmest person on the job site. Generous whitespace, muted surfaces, one accent used sparingly. Nothing shouts.
2. **Data first, chrome last.** The content — budgets, schedules, photos — is the interface. Chrome recedes: hairline borders, low-contrast structure, no decorative gradients on work surfaces.
3. **Fast is beautiful.** Perceived speed is a design property: optimistic UI, skeletons that match final layout, 150 ms motion budgets (NFR-2).
4. **Gloves-and-sunlight real.** Field UI assumes bright sun, dust, gloves, one hand (NFR-20). Big targets, high contrast mode, forgiving gestures.
5. **Premium ≠ delicate.** The aesthetic is *engineered* — precise 8-pt geometry, honest materials, tactile feedback — like a beautifully machined tool, not a fashion app.
6. **One system, three postures.** Desktop (dense command center), tablet (site office), mobile (field capture). Same tokens, different densities — never different products.

---

## 2. Design Tokens

Tokens are the single source of truth (`packages/ui/tokens.ts` → CSS variables → Tailwind theme). All components consume tokens only; raw hex values in component code fail lint.

### 2.1 Color palette

**Neutrals — "Concrete" scale** (slightly warm gray; the app's skeleton):

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `neutral-0` | `#FFFFFF` | `#0E0F11` | page background (dark: near-black, warm) |
| `neutral-50` | `#F7F7F6` | `#16181B` | app canvas |
| `neutral-100` | `#F0F0EE` | `#1D2024` | raised surface / cards |
| `neutral-200` | `#E4E4E1` | `#26292E` | hairline borders, dividers |
| `neutral-300` | `#CFCFCA` | `#33373D` | strong borders, disabled fill |
| `neutral-500` | `#8A8A84` | `#7A7F87` | secondary text, icons |
| `neutral-700` | `#4A4A46` | `#B6BBC2` | primary body text (dark inverts) |
| `neutral-900` | `#1C1C1A` | `#EDEFF2` | headings, high-emphasis |

**Brand accent — "Safety Blue"** `brand-600 #2563EB` (scale 50–900). One accent, used only for primary actions, focus, active nav, links. Rationale: blue reads trustworthy/financial, survives sunlight, and leaves orange/yellow free for their *industry* meanings.

**Semantic colors** (never used decoratively):

| Role | Token | Light | Notes |
|------|-------|-------|-------|
| Success / on-track | `success-600` | `#16A34A` | margin healthy, task done |
| Warning / at-risk | `warning-600` | `#D97706` | schedule slip risk, expiring cert |
| Danger / over | `danger-600` | `#DC2626` | over budget, incident, destructive |
| Info / AI | `ai-600` | `#7C3AED` | **reserved exclusively for AI-generated content** — a violet accent + sparkle glyph marks every AI suggestion, summary, or prediction so humans always know what the machine wrote (FR-AI-4 trust) |

**Data-viz palette:** 8-step categorical set tuned for both modes (starts `#2563EB`, `#0EA5E9`, `#16A34A`, `#D97706`, `#DC2626`, `#7C3AED`, `#DB2777`, `#64748B`); sequential = brand ramp; diverging = danger↔neutral↔success for budget variance. All pairs ≥ 3:1 against surface (per dataviz accessibility rules).

**Contrast rules:** body text ≥ 4.5:1 (WCAG AA, NFR-18); `neutral-500` is the minimum for text; **High-Contrast Field Mode** raises surfaces to pure white/black, borders to `neutral-500`, and minimum text to `neutral-700` for direct sunlight.

### 2.2 Typography

| Token | Family | Notes |
|-------|--------|-------|
| `font-sans` | **Inter** (variable) | UI everywhere; `font-feature-settings: "tnum"` on all numeric data — money/qty columns MUST use tabular numerals |
| `font-display` | Inter Display | ≥ 28 px headings, tighter tracking (-2%) |
| `font-mono` | JetBrains Mono | IDs, codes, API, cost codes |

Type scale (1.2 ratio, 4-pt aligned): `text-xs 12/16`, `sm 13/20` (tables), `base 14/22` (default UI), `md 16/24`, `lg 18/26`, `xl 22/30`, `2xl 28/36`, `3xl 34/42`. Weights: 400 body, 500 UI labels/buttons, 600 headings/emphasis — never 700+ except display. Mobile field surfaces bump base to 16 for legibility.

### 2.3 Spacing, radius, elevation

- **Spacing:** strict 4-pt grid — `space-1: 4` … `space-12: 48`, `space-16: 64`. Component padding uses 8/12/16; sections 24/32; page gutters 24 (desktop) / 16 (tablet) / 16 (mobile).
- **Radius:** `sm 6` (inputs, chips), `md 10` (buttons, cards), `lg 14` (modals, drawers), `full` (pills, avatars). One family — no mixed radii in a compound component.
- **Elevation (shadows are physical, subtle):**
  - `elev-0` flat + hairline border (default cards — Linear-style; borders over shadows)
  - `elev-1` `0 1px 2px rgb(0 0 0 / .05)` hover lift
  - `elev-2` `0 4px 12px rgb(0 0 0 / .08)` popovers, dropdowns
  - `elev-3` `0 12px 32px rgb(0 0 0 / .14)` modals, command palette
  - Dark mode: elevation = surface lightening (`neutral-100→200`), shadows nearly invisible by design.

### 2.4 Grid & layout

- **Desktop app frame:** fixed left sidebar 240 px (collapsible to 64 px icon rail) · fluid content (max 1440 px, centered beyond) · optional right context panel 360 px. Content uses a 12-col grid, 24 px gutters.
- **Tablet:** sidebar becomes icon rail; content 8-col.
- **Mobile:** single column, 16 px gutters, bottom tab bar (5 slots), FAB for primary capture action.
- **Breakpoints:** `sm 640`, `md 768` (tablet portrait), `lg 1024` (tablet landscape/small desktop), `xl 1280`, `2xl 1536`.

### 2.5 Tailwind token mapping (excerpt)

```ts
// tailwind.config excerpt — generated from tokens.ts
theme: {
  colors: { neutral: {...}, brand: {...}, success: {...}, warning: {...},
            danger: {...}, ai: {...} },
  fontFamily: { sans: ['InterVariable'], display: ['Inter Display'], mono: ['JetBrains Mono'] },
  borderRadius: { sm: '6px', md: '10px', lg: '14px' },
  spacing: { /* 4-pt scale */ },
  boxShadow: { 'elev-1': '…', 'elev-2': '…', 'elev-3': '…' },
  transitionDuration: { fast: '120ms', base: '150ms', slow: '240ms' },
  transitionTimingFunction: { out: 'cubic-bezier(.16,1,.3,1)' } // "swift-out", the house curve
}
```

---

## 3. Core Components (`packages/ui`)

All components: Radix primitive base, token-only styling, full keyboard support, `data-state` styling, RTL-safe, dark-mode automatic. Storybook is the living reference; this section defines behavior contracts.

### 3.1 Buttons
- **Variants:** `primary` (brand fill, white text), `secondary` (surface + hairline), `ghost` (text-only), `danger` (danger fill — destructive confirm only), `ai` (violet tint — AI-triggering actions).
- **Sizes:** `sm 28px`, `md 36px` (default), `lg 44px`, `field 52px` (mobile field surfaces — NFR-20 touch target ≥ 48).
- **Rules:** one primary per view region; loading state swaps label for inline spinner *keeping width* (no layout shift); icons 16 px, gap 8; disabled = 40% opacity + `not-allowed`, never hidden.

### 3.2 Forms
- **Inputs** (text, number, currency, date, select, combobox, textarea): 36 px (52 px field mode), hairline border, focus = 2 px brand ring (`ring-offset-1`), label always visible above (never placeholder-as-label), 13 px helper/error text below.
- **Currency input:** right-aligned tabular numerals, currency prefix from tenant locale, accepts "1.2k"→1,200 shorthand.
- **Validation:** zod schema shared with API (§api.md 1.4); inline errors on blur, summarized on submit; error color + icon + text (never color alone — NFR-18).
- **Selects/combobox:** searchable at >7 options; recent + frequent items float to top; create-inline where domain allows ("+ New supplier").
- **Field-mode forms:** one question per screen-section, numeric keypads for qty, voice-input mic on text areas, photo attach inline, giant submit bar pinned bottom.

### 3.3 Tables (the workhorse)
- 13 px text, 40 px rows (compact 32, comfortable 48 — user toggle), sticky header, hairline row dividers only (no zebra), first column sticky on scroll.
- Money/qty right-aligned tabular numerals; status as chips; row hover reveals actions (kebab + inline quick actions); checkbox multi-select with floating bulk-action bar.
- Column: sort, resize, hide/show, saved views per user. Virtualized ≥ 100 rows. Inline edit on double-click where the API allows PATCH.
- Empty/loading/error states standardized (§6).

### 3.4 Cards
- `elev-0` + hairline default; 16 px padding (`lg` 24). Metric card pattern: label (13 `neutral-500`) → value (28 tabular) → delta chip (semantic color + arrow) → sparkline (optional).

### 3.5 Dialogs & drawers
- **Dialog (modal):** center, `elev-3`, max-w 560 (confirm) / 720 (forms); scrim `black/40 backdrop-blur-sm`; Esc + scrim-click close (blocked when dirty — confirm discard); focus-trapped, returns focus on close.
- **Drawer:** right-side 480/640 px for record detail-in-context (open a PO from a table without losing the table). Mobile: bottom sheet with drag handle, snap points 50/90%.
- **Rule:** destructive confirms are dialogs; creation/detail are drawers; never nest two modals.

### 3.6 Navigation
- **Sidebar (desktop):** company switcher (top), module nav with icons + labels, project quick-switcher, collapse to icon rail; active item = brand text + soft brand-50 fill bar.
- **Topbar:** breadcrumb (entity path), global search / **command palette (⌘K)** — the Linear-grade power surface: navigate, create, act ("new PO", "approve CO-014"), fuzzy + recent + NL fallback to AI search; right side: sync status, notifications bell, AI assistant button, avatar.
- **Mobile tab bar:** Today · Projects · Capture (FAB) · Tasks · More. Capture opens the field action sheet (photo / report / time / issue) — the one-thumb path to every field job (persona Marco, ≤ 2 min goal).
- **Keyboard:** every list navigable (↑↓, Enter open, ⌘Enter quick-action); `?` opens shortcut sheet; all shortcuts re-mappable.

### 3.7 Charts (see `dataviz` conventions)
- Library: Recharts (web) with house theme. Hairline axes (`neutral-200`), no gridline clutter (y-only, dashed), 13 px tabular labels, direct series labeling over legends when ≤ 4 series, tooltips follow cursor with 120 ms fade.
- House charts: budget waterfall (original→COs→revised→actual), S-curve (planned vs actual), Gantt (§7), margin trend with confidence band (AI forecast in violet band), utilization heatmap.

### 3.8 Icons & illustration
- **Icons:** Lucide, 16/20/24 px, 1.5 px stroke, `neutral-500` default. Domain glyph set (extends Lucide, same grid): crane, rebar, concrete mixer, hard hat, blueprint, punch pin, RFI, change order, pour, inspection.
- **Illustration style:** minimal line illustrations (2 px stroke, one brand-tint fill) for empty states/onboarding only — never on work surfaces. Tone: capable, quietly optimistic; no cartoons.
- **Photography:** real job-site photography (marketing/onboarding): natural light, honest work, no stocky hard-hat clichés; duotone (neutral + brand) treatment when used as backdrop.

---

## 4. Motion & Microinteractions

- **Budget:** UI transitions ≤ 150 ms (`base`), entrances 240 ms (`slow`), micro-feedback 120 ms (`fast`). House curve `swift-out`; springs (RN Reanimated / Framer Motion) for sheets and drags. `prefers-reduced-motion` → crossfades only.
- **Patterns:**
  - Optimistic commit: change applies instantly; a 2 px brand progress hairline under the topbar is the only "saving" signal; failure = shake + toast + revert.
  - List changes: FLIP reorder, 150 ms; new row slides in with brand-50 flash that fades 800 ms.
  - Number changes animate (count-up 240 ms) on dashboards — money feels alive but not gamified.
  - Sync: field app shows a quiet cloud glyph (synced ✓ / pending n / offline) — always visible, never a blocking spinner (NFR-3).
  - AI streaming: violet cursor shimmer while tokens stream; sources chip row fades in after completion.
  - Success moments (CO approved, project won): single subtle confetti-free "pulse" on the entity chip — premium restraint, no fireworks.

---

## 5. Modes & Responsive Rules

### 5.1 Light & dark
- Both first-class from day one; system-follow default, manual override per user. Dark is *not* inverted light: surfaces per §2.1 dark ramp, brand desaturated one step (`brand-500`), semantic colors +10% lightness, shadows→surface lightening. Charts re-tuned per palette table.
- **Field High-Contrast mode** (§2.1) is a third scheme, auto-suggested when ambient light sensor reports direct sun (mobile).

### 5.2 Responsive behavior matrix

| Surface | Desktop ≥1024 | Tablet 768–1023 | Mobile <768 |
|---------|---------------|-----------------|-------------|
| Nav | Sidebar 240 | Icon rail 64 | Bottom tabs |
| Tables | Full columns | Priority columns (col-priority tokens) | Card-list transform (each row → card with key fields) |
| Gantt | Full | Condensed rows | Read-only lookahead list |
| Detail | Drawer right | Drawer right | Full-screen push |
| Dashboard | 12-col grid | 8-col, 2-across cards | 1-col stacked, metric cards first |
| Create/edit | Drawer/dialog | Drawer | Full-screen stepper |

Rule: features are never *removed* on small screens, they re-form. The one exception: complex schedule editing is desktop/tablet-only; mobile gets progress updates + lookahead (deliberate — field personas don't resequence CPM on a phone).

---

## 6. States (standardized, mandatory)

- **Loading:** skeletons mirroring final layout (shimmer 1.2 s loop) — never spinners on content areas; spinners only inside buttons. Skeleton count = expected rows (from cache when known).
- **Empty:** illustration (sm) + one-line headline + one-line help + primary CTA (+ "import" secondary where relevant). Copy is instructive, not cute: *"No purchase orders yet. Create one or draft from budget needs."*
- **Error:** inline (field), section (card with retry), page (full-state with trace id + support link). Never a dead end — always retry or path out. Offline (field): amber banner "Working offline — changes will sync," full functionality (NFR-11).
- **Permission-denied:** explains *what role* grants access ("Requires Finance approval permission") — turns dead ends into requests.
- **Conflict (sync):** side-by-side resolution card (mine/theirs per field) — plain language, one tap per field (NFR-12).

---

## 7. Construction-Specific Components

| Component | Contract |
|-----------|----------|
| **BudgetGrid** | Cost-code tree grid: expandable divisions, 7 money columns (original/changes/revised/committed/actual/CTC/FAC), variance heat-tint on FAC vs revised, row drill → transactions drawer |
| **GanttBoard** | Virtualized timeline: drag move/resize (desktop), dependency lines with hover trace, critical path toggle (danger tint), baseline ghost bars, weather row overlay, today line |
| **LookaheadBoard** | Week-column pull-plan: activity cards, constraint chips, drag between weeks (tablet-friendly) |
| **DrawingViewer** | Tiled PDF/raster viewer: pinch/scroll zoom, version compare slider (A/B overlay), markup toolbar (pen/box/text/measure), pin-drop → task/RFI/punch, offline tile cache badge |
| **PhotoGrid** | Justified grid, date/location clusters, AI-tag filter chips (violet), lightbox with EXIF/map panel, batch-attach |
| **DailyReportComposer** | Field-mode stepper: crew grid (tap-count workers), weather auto-chip, voice-to-narrative (violet mic), photo strip, offline-first save bar |
| **StatusChip** | Single source for every entity status: semantic color mapping table lives in tokens; never ad-hoc colored text |
| **CostCodePicker** | Hierarchical combobox: code+name search, recent codes, division grouping — used in 20+ flows, one component |
| **ChangeOrderCard** | Client-portal variant: plain-language summary, price/schedule impact callouts, one-tap approve with signature capture |
| **HealthRing** | Project health: 4-segment ring (schedule/budget/safety/quality) with score center; tap → factor breakdown |
| **AIAnswerBlock** | Violet-tinted container: streamed answer, `sources[]` chip row (tap → source record), confidence meter, thumbs feedback, "insert/apply" action — the *only* approved wrapper for AI output (FR-AI-4) |
| **SyncBadge** | Global sync state glyph + queue drawer (pending mutations list, per-item retry) |
| **WeatherStrip** | Daily report/schedule header: NOAA/met-source chips per day, delay-risk tint |
| **ApprovalFlow** | Maker/checker rail: avatars + states, pending-on-you highlight, audit link |

---

## 8. Accessibility (NFR-18)

- WCAG 2.1 AA audited per release (axe CI + manual screen-reader pass on core flows).
- Full keyboard operability; visible focus (2 px brand ring, 2 px offset) never suppressed.
- Touch targets ≥ 44 px (52 field mode); gesture actions always have button equivalents.
- Color never sole signal (icons + text with semantic states); charts get pattern fills in high-contrast mode.
- Screen-reader landmarks per app frame; live regions for async results and sync status; tables with proper header scopes; dialogs `aria-modal` with labelled titles.
- Localization-ready: no text in images, 40% string-expansion headroom, RTL mirroring via logical properties (NFR-30).

---

## 9. Voice & Content Style

- **Tone:** competent foreman, not chatbot: direct, concrete, zero exclamation marks in UI chrome. Sentence case everywhere (buttons included). Numbers with tabular formatting and explicit units.
- Dates: relative within 7 days ("Tue · in 3 days"), absolute beyond (locale format). Money: always currency-signed, thousands-separated, negatives in danger color + parentheses in financial tables.
- Errors name the fix, not the fault: *"Required-by date must be after order date"* not *"Invalid input."*
- AI content is always labeled ("AI draft — review before sending") inside AIAnswerBlock — no exceptions (spec P8).

---

## 10. Governance

- Tokens and components live in `packages/ui`; any new pattern requires a design-review PR (Storybook story + a11y check + dark/light/field screenshots).
- Drift control: visual regression (Chromatic-class) on every PR; hex-literal lint; a component may not ship used once — patterns enter the system only on second use (rule of two).
- This document + Storybook are the contract; Figma libraries mirror tokens via Tokens Studio sync.

---

*End of `ui-design-system.md` v1.0.*
