# VERA

InnovareAI's content automation platform — the creative-side counterpart to SAM.
A multi-client B2B agency tool where every workspace is a dedicated environment
for one client org.

Production: <https://vera.innovareai.com>

## What VERA does

- **Onboarding wizard** collects company channels (LinkedIn, blog, etc.)
- **Audit** the connected channels — LinkedIn profile score + brew360
  scoring, content voice extraction, brand voice and persona library
- **Generate** content via a multi-agent orchestrator (strategy → research
  → writing → image)
- **Review** drafts in a Trello-style board or list, side panel for full
  detail, per-channel publish actions
- **Publish** to LinkedIn (via Unipile), Blog (via GitHub→Netlify MDX),
  Email (via Postmark)
- **Intel** — daily competitor research agent
- Multi-workspace, multi-client, multi-tenant ready (auth deferred)

## Stack

- React 19 + Vite + TypeScript + Tailwind 4
- Self-hosted Supabase on Hetzner (database, edge functions, storage)
- Netlify for static hosting + per-PR previews
- Sentry for crash reporting (optional — gracefully no-ops without DSN)

Backend repo: <https://github.com/InnovareAI/content-pipeline> — edge
functions, migrations, ops runbook.

## Local development

```bash
git clone git@github.com:InnovareAI/content-studio.git
cd content-studio
cp .env.example .env.local      # fill in VITE_SUPABASE_URL + ANON_KEY at minimum
npm install
npm run dev                     # http://localhost:5173
```

The dev branch in `lib/orgContext.tsx` synthesises workspace membership
from the `organizations` table when no Supabase session is present, so
you can demo the UI without GoTrue wired up locally.

## Build & deploy

Netlify auto-deploys on push to `main`. To build manually:

```bash
npm run build                   # tsc -b && vite build → dist/
npm run preview                 # serve dist/ on :4173
```

Environment variables are set in the Netlify UI under
**Site settings → Environment variables**. Required:

| var | required | notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | `https://supabase-content-eu.innovareai.com` |
| `VITE_SUPABASE_ANON_KEY` | yes | anon JWT from the content stack |
| `VITE_OPENROUTER_API_KEY` | yes | client-side image/text generation paths |
| `VITE_ANTHROPIC_API_KEY` | yes | Brand Guard + direct Claude calls |
| `VITE_SENTRY_DSN` | optional | when absent, Sentry SDK is tree-shaken out |
| `VITE_RELEASE` | optional | commit SHA for per-deploy crash tracing |

## Architecture notes

- **Theme:** `lib/theme.tsx` — light / dark / system, persisted in
  `localStorage` (`vera-theme` key, falls back to `kai-theme` for the old
  brand)
- **Org context:** `lib/orgContext.tsx` — single source of truth for the
  active workspace; switching here cascades to every page
- **Error handling:** `components/ErrorBoundary.tsx` — top-level (in
  `App.tsx`) catches provider/shell crashes; route-level (inside
  `Layout`) keeps the rail visible when a single page blows up;
  auto-resets on navigation
- **Sentry:** `lib/sentry.ts` — thin wrapper, callers don't need to
  defensively check the DSN
- **Edge function calls:** all functions are at
  `https://supabase-content-eu.innovareai.com/functions/v1/<name>` and
  authenticated with the service-role key (server-side calls only) or
  the anon key (browser calls)

## Linting

```bash
npm run lint                    # eslint .
```

There are 15 pre-existing errors in `Skills.tsx` and
`vera-orchestrator/index.ts` that pre-date this README — they aren't
gating deploys but should be cleaned up in a focused pass.

## Related

- Backend repo + runbook: <https://github.com/InnovareAI/content-pipeline>
- SAM (sales-side counterpart): separate stack, separate database, no
  data sharing today

## Production status

Internal-first. Auth wiring (Google / Microsoft SSO via GoTrue) is
deferred — the dev-mode org context loads workspaces directly. RLS is
permissive for the same reason. Both will tighten before external users.
