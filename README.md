# VERA

InnovareAI's B2B demand content operating system, the marketing and content counterpart to SAM.

VERA learns each client from their website, channels, documents, and performance data, then turns that knowledge into platform-native content, approvals, publishing, measurement, and learning loops.

Production: <https://vera.innovareai.com>

## What VERA Does

- Onboards each client as a scoped project with its own brain, channels, roles, and provider keys.
- Learns from website pages, SEO structure, product pages, blog content, documents, LinkedIn, Instagram, YouTube, Medium, Quora, Reddit, Facebook, and X where available.
- Drafts B2B top-of-funnel content for company, founder, expert, and campaign voices.
- Reviews content with platform-native previews, scheduling, approval states, and stakeholder routes.
- Publishes or hands off through client-scoped connections only.
- Measures comments, shares, saves, clicks, qualified traffic, buyer questions, objections, meeting requests, and SAM handoff signals.
- Feeds results back into the next brief, model recommendation, channel plan, and reusable skills.

## Stack

- React 19, Vite, TypeScript, Tailwind 4.
- Self-hosted Supabase on Hetzner for database, Edge Functions, auth, storage, and cron-style workers.
- Netlify for the static frontend.
- Sentry for optional browser crash reporting.

## Key And Spend Policy

Do not put LLM, image, video, publishing, scraping, OAuth, or third-party API secrets in browser variables.

Browser-exposed variables must be limited to `VITE_*` values that are safe to ship publicly. Provider keys are handled in one of two ways:

- Client-owned keys are stored encrypted in `client_api_keys` and scoped to that client project.
- InnovareAI platform keys live only in the self-hosted Supabase environment and require explicit operator entitlements plus an approved platform project.

Client media generation must not fall back to InnovareAI FAL, OpenAI, or OpenRouter keys by default. Video is storyboard-first and requires a client FAL key unless the request is from an entitled InnovareAI operator inside an approved platform media project.

## Local Development

```bash
git clone git@github.com:InnovareAI/vera.git
cd vera
cp .env.example .env.local
npm install
npm run dev
```

Local app URL: <http://localhost:5173>

Minimum browser variables:

| var | required | notes |
|---|---:|---|
| `VITE_SUPABASE_URL` | yes | `https://supabase-content-eu.innovareai.com` |
| `VITE_SUPABASE_ANON_KEY` | yes | Public anon key, protected by RLS and Edge Function authorization |
| `VITE_SENTRY_DSN` | no | Optional browser crash reporting |
| `VITE_RELEASE` | no | Optional commit SHA or version label |

Server-only variables are documented in `.env.example`. They belong on the Hetzner Supabase host at `/srv/supabase-content/.env`, not in Netlify browser env vars.

## Build And Deploy

Netlify deploys production from `main`. To build locally:

```bash
npm run build
npm run preview
```

The production frontend points to the self-hosted Supabase content stack at:

```text
https://supabase-content-eu.innovareai.com/functions/v1/<function-name>
```

Browser calls use the user session or anon key where allowed. Server-to-server function calls use service-role credentials only inside the Edge Function runtime or server environment.

## Product Plan

The current execution plan lives in [docs/VERA_BUILD_PLAN.md](./docs/VERA_BUILD_PLAN.md).

The working UX blueprint lives in [docs/UX_BLUEPRINT.md](./docs/UX_BLUEPRINT.md).

## Architecture Notes

- Theme: `src/lib/theme.tsx`, persisted under `vera-theme`.
- Org context: `src/lib/orgContext.tsx`, active workspace and membership state.
- Project context: `src/lib/projectContext.tsx`, active client project and project switching.
- Right rail: `src/lib/rightRailContext.tsx`, shared preview and artifact panel.
- Error handling: `src/components/ErrorBoundary.tsx`, page and route boundaries.
- Client AI policy: `src/pages/ClientKeys.tsx`, per-client provider keys, budget caps, model defaults, and usage views.
- Model economics: `src/lib/modelEconomics.ts`, shared frontend labels, options, premium flags, and planning estimates.

## Verification

```bash
npm run build
npm run lint
deno check supabase/functions/<function>/index.ts
```

Use focused Deno checks for touched Edge Functions. Some lint debt may exist outside the edited surface, so do not treat an unrelated lint failure as proof that the changed code is broken.
