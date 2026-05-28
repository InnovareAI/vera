// VERA design tokens — typed mirror of the canonical CSS variables.
//
// Source of truth: src/index.css :root block (also documented in
// public/vera-design-system.html via claude.ai/design).
//
// Components reference these typed names instead of hardcoding
// 'var(--paper)' literals. Keeps the surface refactor-safe.

// ─── COLOR ──────────────────────────────────────────────────────────
export const color = {
  // Paper & ink
  paper:        'var(--paper)',         // page canvas
  paper2:       'var(--paper-2)',       // subtle fill on paper (rails, hover)
  surface:      'var(--surface)',       // raised white over paper
  ink:          'var(--ink)',           // primary text + CTA fill
  ink2:         'var(--ink-2)',         // secondary text
  ghost:        'var(--ghost)',         // tertiary text, labels
  faint:        'var(--faint)',         // quaternary, placeholders
  line:         'var(--line)',          // hairline rule
  line2:        'var(--line-2)',        // stronger hairline

  // Accent — use sparingly, max 4 surface moments per screen
  accent:       'var(--accent)',
  accentInk:    'var(--accent-ink)',    // hover state
  accentSoft:   'var(--accent-soft)',   // 6% rgba tint background
  accentLine:   'var(--accent-line)',   // hairline at 18% opacity

  // Status — dots only, never fills
  success:      'var(--success)',
  warn:         'var(--warn)',
  danger:       'var(--danger)',
  info:         'var(--info)',

  // Channel dots (existing usage in StatusChip/PlatformChip)
  dotBlue:      'var(--dot-blue)',
  dotSky:       'var(--dot-sky)',
  dotPink:      'var(--dot-pink)',
  dotAmber:     'var(--dot-amber)',
  dotGreen:     'var(--dot-green)',
  dotRose:      'var(--dot-rose)',
  dotViolet:    'var(--dot-violet)',
  dotOrange:    'var(--dot-orange)',
} as const

// ─── TYPE ───────────────────────────────────────────────────────────
export const type = {
  size: {
    micro:    'var(--t-micro)',     // 11px — uppercase section labels
    cap:      'var(--t-cap)',       // 12px — captions, helper text
    sm:       'var(--t-sm)',        // 13px — dense body, buttons
    body:     'var(--t-body)',      // 14px — primary body
    lg:       'var(--t-lg)',        // 15px — emphasized body
    h4:       'var(--t-h4)',        // 17px
    h3:       'var(--t-h3)',        // 20px
    h2:       'var(--t-h2)',        // 26px
    h1:       'var(--t-h1)',        // 34px
    display:  'var(--t-display)',   // 44px
  },
  weight: {
    regular:  400,
    medium:   500,
    semibold: 600,
  },
  family: {
    sans:     "var(--font-body)",   // Geist
    mono:     "var(--font-mono)",   // Geist Mono
  },
  letterSpacing: {
    tight:    '-0.025em',           // display
    snug:     '-0.01em',            // h1/h2
    normal:   '0',
    wide:     '0.08em',             // uppercase labels
  },
  lineHeight: {
    tight:    1.1,
    snug:     1.3,
    normal:   1.5,
    relaxed:  1.65,
  },
} as const

// ─── SPACE ──────────────────────────────────────────────────────────
// 4px base scale. Use named tokens; never raw px.
export const space = {
  0:  'var(--s-0)',   // 0
  1:  'var(--s-1)',   // 2px
  2:  'var(--s-2)',   // 4px
  3:  'var(--s-3)',   // 6px
  4:  'var(--s-4)',   // 8px
  5:  'var(--s-5)',   // 12px
  6:  'var(--s-6)',   // 16px
  7:  'var(--s-7)',   // 20px
  8:  'var(--s-8)',   // 24px
  9:  'var(--s-9)',   // 32px
  10: 'var(--s-10)',  // 40px
  11: 'var(--s-11)',  // 56px
  12: 'var(--s-12)',  // 80px
} as const

// ─── RADIUS ─────────────────────────────────────────────────────────
export const radius = {
  none: 'var(--r-0)',
  xs:   'var(--r-1)',   // 3px — chips, kbd
  sm:   'var(--r-2)',   // 5px — buttons, inputs
  md:   'var(--r-3)',   // 8px — cards
  lg:   'var(--r-4)',   // 12px — palette, modal
  pill: 'var(--r-pill)',
} as const

// ─── MOTION ─────────────────────────────────────────────────────────
export const motion = {
  tap:    'var(--m-tap)',    // 80ms
  fast:   'var(--m-fast)',   // 120ms
  base:   'var(--m-base)',   // 180ms
  slow:   'var(--m-slow)',   // 240ms
  ease:   'var(--ease)',
} as const

// ─── Z-INDEX ────────────────────────────────────────────────────────
export const z = {
  base:    'var(--z-base)',
  sticky:  'var(--z-sticky)',
  nav:     'var(--z-nav)',
  popover: 'var(--z-popover)',
  toast:   'var(--z-toast)',
  modal:   'var(--z-modal)',
  palette: 'var(--z-palette)',
} as const

// ─── SHADOW (overlays only) ─────────────────────────────────────────
export const shadow = {
  pop:    'var(--shadow-pop)',
  modal:  'var(--shadow-modal)',
} as const
