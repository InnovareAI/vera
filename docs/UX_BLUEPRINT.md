# VERA — Workflow-Driven UX Blueprint

**Status:** Historical UX blueprint. The current execution plan lives in [VERA_BUILD_PLAN.md](./VERA_BUILD_PLAN.md).

**Provenance:** Produced by an 8-agent workflow (map current state → 3 competing organizing spines → judge → synthesize). Every structural claim verified against the real codebase — route line numbers, schema columns, the missing engagement fields, the unwritten `projects.instructions`.

**Winning spine:** Project Hub — *one client desk, one loop, many clients on a shelf.* (Score 36/40; beat "The Standing Brief" 28 and "The Line" 26.)

---

## 1. The canonical operator workflow (the spine)

**One sentence:** VERA is a per-client loop the operator *steers* and VERA *drives* — inside each client project, a single `Set up → Brief → Draft → Approve → Publish → Measure → Notice → repeat` cycle runs, carried stage-to-stage by VERA's observations; switching between clients is the only move above that loop.

The product is therefore **hub-and-spoke at the workspace level** (many client loops on one shelf) and **cyclical inside each spoke** (one self-feeding content loop per client). It is not a feature menu.

### The eight stages

| # | Stage | Operator goal | VERA's job |
|---|-------|---------------|------------|
| 0 | **Onboard** (open the project) | Stand up a client as a bounded scope in seconds | Greet the gap: "I don't know RDF Style yet — point me at the site, drop a deck, or tell me the vibe." |
| 1 | **Set ground truth** (voice + knowledge) | Load voice, positioning, references once; lean on them forever | Ingest → classify → confirm what was learned → clear the `knowledge_gap`; the readiness pip flips green |
| 2 | **Brief** (point at the next move) | Say what to make next in plain language | Often briefs *itself* (`empty_queue`, Asana, Intel) → operator approves or redirects |
| 3 | **Draft** (VERA + team produce) | Get a 90%-there draft (copy + image) | 9-agent pipeline runs inline; the *result* is the hero, the process collapses behind "show thinking" |
| 4 | **Approve** (steer creative direction) | Be the taste-and-risk gate — fast, across many drafts/clients | Absorbs everything mechanical; operator's verbs are **Approve / Tweak / Kill** |
| 5 | **Publish** (across channels) | Get content live on this client's channels, zero reformat | "Publish to RDF's LinkedIn + journal now, or schedule Tuesday 9am?" — handles per-channel formatting |
| 6 | **Measure** (close the loop) | Know what landed, so the next brief is smarter | Pulls outcomes back per-client; outcomes become the *evidence* in the next proposal |
| 7 | **Notice → propose** (carry the loop) | Never start from a blank page | Ranked proposals per-client and across the whole book; acting flows straight back into Brief/Draft |

Stage 6 (**Measure**) is the one genuine hole in the backend today — `content_posts` has only `posted_at` + `posted_url` (migration 006), zero engagement columns. This blueprint builds those columns before it renders Measure as a surface. We do not ship empty rooms.

---

## 2. The organizing principle

> **Workflow drives UX. The product is organized around how the work flows, not feature-by-feature.**

Three rules fall out of that, and they govern every decision below:

1. **Chat is a ROLE, not a layout.** VERA (chat) is the one **DOING** surface — every generative/agentic act happens in one project thread. Pages are the **SEEING** surfaces — Home (triage), Review (judgment), Knowledge (ground truth), Brain (config), Measure (outcomes). This is what structurally kills the two-composer problem: there is exactly one conversational surface with one backend (`vera-chat`, extended with a `run_pipeline` tool). "Two composers on one page" becomes *impossible*, not merely discouraged.

2. **Everything about a client lives inside the client.** Every loop-nav item is a single route under `/p/:slug/*` — the exact pattern Layout.tsx already declares ("the canvas is just `<Outlet/>`, no tabs, no breadcrumbs"). This fixes the real structural bug: `/audit`, `/intel`, `/library` are flat routes (Layout.tsx lines 522-524) that silently escape the project frame. Nothing about a client may live outside the client.

3. **VERA's observations are the connective tissue.** The thread's default content is VERA's own proposals, not a blank composer. The operator mostly *approves creative direction* rather than driving every click. The agentic loop is the spine — surfaced at two altitudes (per-client masthead + cross-client morning triage) — but honest, navigable pages remain as the escape hatch, because only 3 input-side signals ship today and betting the whole product on signal quality with no fallback is reckless.

---

## 3. Information architecture

### Two altitudes. No third nav. The "More" drawer dies.

```
ALTITUDE 1 — THE SHELF (workspace)
  /                     → Across Clients (morning triage: every project's ranked observations + per-client pulse)
  left rail top         → workspace switcher · "+ New client" · Starred + Recent projects

ALTITUDE 2 — THE DESK (one client, all routes under /p/:slug/*)
  /p/:slug              → HOME      (desk: VERA's agenda masthead + loop-status strip + Needs-you / Recently-live)
  /p/:slug/vera         → VERA      (the one composer — chat + inline 9-agent pipeline)
  /p/:slug/review       → REVIEW    (judgment queue; board default; detail panel; publish)
  /p/:slug/knowledge    → KNOWLEDGE (ingest → classify → confirm; readiness pip)
  /p/:slug/brain        → BRAIN     (instructions + brand voice + audiences + channels; re-runnable audit)
  /p/:slug/measure      → MEASURE   (outcomes; Audit tab + Intel tab, both per-project)
```

The left rail's six current items (Overview/Review/Knowledge/Audit/Intel/Library) become the six loop-nav items above. Audit and Intel are no longer flat routes — they are tabs of Measure. Library is dissolved. The floating ChatPanel dock is gone (VERA is a tab). The Layout.tsx line 735 hide-hack is deleted because there is only one conversational surface.

### What the operator sees first

- **Morning, across the book:** `/` — "What does VERA want across all 12 clients, right now," ranked by severity then recency. One-click Approve/Dismiss per row; clicking a row drops into that client's desk at the relevant spot.
- **Sitting at one desk:** `/p/:slug` Home — VERA's agenda for *this* client is the **masthead** (not a buried panel). Below it, the loop is glanceable; below that, "Needs you" and "Recently live."

### The flow between stages (who carries each handoff)

```
onboard ──knowledge_gap obs──▶ set ground truth ──pip turns green──▶ brief
brief ──empty_queue / asana / intel obs──▶ draft ──pipeline result card──▶ approve
approve ──"N awaiting" nudge──▶ publish ──"now or Tuesday?" obs──▶ measure
measure ──outcome obs ("sensory posts +40%")──▶ notice ──▶ back to brief
```

Every arrow is a VERA observation. That is the spine made literal.

### ASCII layout — PROJECT HOME (the primary surface)

```
┌────────────────┬──────────────────────────────────────────────────────────┬─────────────────────┐
│  SHELF (rail)  │  RDF STYLE · Home                                          │  THIS CLIENT        │
│                │                                                            │                     │
│  ◇ Workspace ▾ │  ┌──────────────────────────────────────────────────────┐│  Readiness          │
│  + New client  │  │  VERA WANTS TO                              [3]        ││  ● Voice set        │
│                │  │  ┌────────────────────────────────────────────────┐  ││  ● Knowledge fed    │
│  ★ STARRED     │  │  │ ▲ Spring campaign has nothing this week.        │  ││  ○ Channels (1/3)   │
│   • RDF Style ◀│  │  │   Draft 3 posts on the linen story?             │  ││                     │
│   • InnovareAI │  │  │            [ Approve ]  [ Tweak ]  [ Dismiss ]   │  ││  Channels           │
│                │  │  └────────────────────────────────────────────────┘  ││   in LinkedIn  ✓    │
│  RECENT        │  │  ┌────────────────────────────────────────────────┐  ││   ▭ Journal   ✓     │
│   • Acme       │  │  │ ◷ LinkedIn audit is 41 days stale → Re-run?     │  ││   ✉ Email    — set  │
│   • Lumen      │  │  │            [ Approve ]            [ Dismiss ]   │  ││                     │
│                │  │  └────────────────────────────────────────────────┘  ││  THIS WEEK          │
│ ─────────────  │  └──────────────────────────────────────────────────────┘│   3 drafted         │
│  HOME      ◀───│                                                            │   2 published       │
│  VERA          │   THE LOOP                                                 │   +40% vs last wk   │
│  REVIEW    [2] │   Brief ──▶ Draft ──▶ Review ──▶ Publish ──▶ Measure       │                     │
│  KNOWLEDGE     │     1        2         •2         1           live         │                     │
│  BRAIN         │                                                            │                     │
│  MEASURE       │   NEEDS YOU (2)                    RECENTLY LIVE           │                     │
│                │   ▸ "Linen drop" hook    →Review   ▸ "Quiet luxury" · +1.2k│                     │
│ ─────────────  │   ▸ Founder POV draft    →Review   ▸ "Slow mornings" · 318 │                     │
│  ⚙  ◐  ◯ avatar│                                                            │                     │
└────────────────┴──────────────────────────────────────────────────────────┴─────────────────────┘
       rail                              canvas = <Outlet/>                       right identity card
```

### ASCII layout — VERA (the one composer, `/p/:slug/vera`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  RDF STYLE · VERA                                                              │
│                                                                                │
│   VERA  ▸ Spring campaign has nothing this week. Want 3 posts on the linen     │
│           story? I'll keep it sensory, never clinical.    [Approve] [Redirect] │
│                                                                                │
│   YOU   ▸ Approve — but lead with the founder's hands-on-fabric moment.        │
│                                                                                │
│   VERA  ▸ ⟳ On it.  Strategist → Writer → BrandGuard → Compliance              │
│           ┌─────────────────────────────────────────────┐  ▸ show thinking ▾  │
│           │  DRAFT · LinkedIn                            │                     │
│           │  [image: hands on raw linen, morning light] │                     │
│           │  "She runs the bolt between two fingers..."  │                     │
│           │            [ Approve ]  [ Tweak ]  [ Regen ] │                     │
│           └─────────────────────────────────────────────┘                     │
│                                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │  Ask VERA, or brief the next post…                          [↑]  [+image]  ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

"Approve" in-thread routes the post into **Review's** queue (status flips, it appears in "Needs you"). The judgment surface stays the single source of truth — approvals are never split across two places.

---

## 4. Where every current surface goes

| Current surface | Verdict | New home |
|---|---|---|
| **Dashboard (Overview)** | **rework** | → **Project Home** (`/p/:slug`). Observations promoted to masthead; audit/review glances absorbed; loop-status strip + readiness pip added. Reuses the just-refactored Dashboard on design primitives. |
| **Generate** | **merge → cut route** | → **VERA** tab. Pipeline runs inline via `run_pipeline` tool. `/generate` route deleted. Kills "two composers." |
| **VERA ChatPanel (dock)** | **merge → cut concept** | → **VERA** tab (promoted from 64px strip to a first-class surface). No dock to minimize. |
| **Review** | **keep** | `/p/:slug/review`. Promoted to judgment home base. Board becomes default view. Verbs → Approve / Tweak / Kill; **Tweak loops back to the VERA thread.** |
| **ReviewDetail** | **merge** | Folds into Review's detail panel. `/review/:id` cut as a route. Publish actions move to the panel; per-channel chips replace hardwired LinkedIn buttons. |
| **Knowledge** | **keep** | `/p/:slug/knowledge`. Per-doc `suggestion` becomes an **Approve button wired to vera-act** (closes the dead-end). Drives the readiness pip. |
| **Audit (LinkedInScore + Brew360)** | **rework** | → **Measure → Audit tab**, re-scoped **per-project** (drop the org-only keying). One entry route, not three. |
| **Intel** | **rework** | → **Measure → Intel tab**, per-project. "Brief a response" deep-links into the VERA thread, not flat `/generate`. Refresh also becomes a vera-notice signal. |
| **Library** | **cut** | Dissolved. Posts → Review (already owns them). Audiences → Brain. Campaigns → Measure/Home planning. Nothing survives standalone. |
| **Settings** | **rework / split** | Workspace + Team stay as thin **workspace Settings**. Brand Voice → **Brain**. Integrations/Publishers → per-project **Channels** (Brain + Home identity card). |
| **Onboarding + OnboardingAudit** | **rework** | "New client = open project." NewProjectModal becomes cold-start; VERA greets the gap in-thread. LinkedIn audit becomes **one optional grounding move**, not the mandatory `AuditRedirect` gate. `content-audit`/`seo-audit` re-runnable from Brain. |
| **Clients** | **cut** | Pure duplicate of the workspace switcher's client list. |
| **Calendar** | **cut** | Review's project-scoped calendar already covers it; operator rejected calendar-first. |
| **Templates** | **cut** | Briefs fold into Knowledge (classified `brief`) + VERA starter chips. |
| **Skills** | **rework** | → advanced tab of **workspace Settings**. `vera-refine-skills` proposals surface as observations in Across-Clients (self-improvement becomes visible/approvable). |
| **Agency** | **rework → merge** | → **Across Clients** (`/`). The only surface with `agency_id` scoping + cross-client stats. Becomes the morning-triage agenda, not a roster page. |
| *(new)* **Brain** | **new** | `/p/:slug/brain`. Instructions (writes `projects.instructions` — migration 026, nothing writes it yet) + per-project Brand Voice + Audiences editor + Channels + re-runnable audit. The Claude.ai "custom instructions + knowledge + voice" promise, finally with a home. |

---

## 5. Orphaned capabilities, now surfaced

The backend is far richer than the UI. Three clusters get their due:

### Publishing connectors (the biggest capability/surface gap)
The 8 CMS connectors + Unipile + email are a serious 6-verb platform (connect/health_check/dry_run/publish/verify/unpublish) with idempotency, an audit log, and a daily health cron — yet today connecting is buried in a Settings sub-tab and the prominent publish buttons hardwire only `unipile-post`/`blog-publish`/`email-publish` while the 8 connectors hide in a collapsed dropdown on ReviewDetail.

- **Connect side** → **Brain → Channels** (per-client, glanceable: "which channels does THIS client publish to"). `auto-discover-publisher` + `detect-cms` run when VERA onboards a client's blog.
- **Publish side** → **Review detail panel** as **first-class channel chips** — LinkedIn and the 8 CMS connectors as equal buttons, not a legacy dropdown. `dry_run` preview + `verify` + per-publisher health show inline.
- **Health as a signal** → `publish-health-check` failures become a `connector_health` observation ("RDF's WordPress token expired") instead of a silent dot.

### The agentic loop (the spine)
`vera-notice` already walks all projects (`for (const p of projects)`) and `agent_observations` carries `org_id` + `project_id` with an `(org_id, project_id, created_at desc)` open-index — so the cross-client Agenda is a **query change, not new infra.** The loop is surfaced at two altitudes (Home masthead + `/` triage) and **vera-act gets visible execution**: acting posts a live "VERA is drafting…" card that streams and resolves into a Draft Card in the thread — not today's fire-and-navigate that writes `acted_result` nobody sees.

Signal build-out (today: 3 input-only — `stale_audit`, `knowledge_gap`, `empty_queue`), in priority order:
1. **outcome** — needs the new engagement columns; fires "sensory posts outperform promo 3:1 — lean in?" / "this theme is dying." Closes the loop's open output side.
2. **connector_health** — "your WordPress token expired."
3. **competitor_intel** — `discover-competitor-intel` as a signal, not a page to remember to Refresh.
4. **craft** — `vera-refine-skills` / `vera-refine-kb` weekly crons surface "I improved my hook skill — review?"
5. **asana_brief** — open Asana Content Plan tasks become inbound Brief proposals.

### Knowledge classification & synthesis
`project-ingest` already emits a per-doc `suggestion` ("apply these as the brand voice rules?") that currently dead-ends as passive text. **Wire it to an Approve button → vera-act**, so the most agentic part of ingest posts a result back. The synthesis layer (`kb_synthesize`, `kb_audit_summary`) — today chat-only — gets a "Synthesize wiki" action + a KB-health line on the Knowledge page; `vera-refine-kb` proposals appear as craft observations.

**Also wired up while we're here:** `generate-video` (a "Generate video" action on the draft card — the backend exists, nothing calls it); `generate-image`/`generate-infographic` attach visibly to the draft card (critical for luxury/wellness/food clients), not chat-only.

---

## 6. Decisions RESOLVED

**Chat-first vs pages-first → HYBRID, resolved by ROLE.**
Chat (VERA) is the one **doing** surface; pages are the **seeing** surfaces. Chat is a named tab peer to Review/Knowledge — not a dock bolted on, not the whole app. Exactly one conversational surface, one backend (`vera-chat` + `run_pipeline`). "Two composers" cannot recur. Reference stays Linear + Notion — monochrome, quiet, structured — **not** a chat toy and **not** a reverse-chronological feed that re-creates "too cluttered" in a new shape. We explicitly reject dissolving Dashboard/Review/Generate into one feed (Spine 1's core move) and reject kanban-as-home where the human drags cards (Spine 3's core move — that *foregrounds process* and is *more* human-led, the opposite of the stated direction).

**Merge PR #1's Create surface → YES. Merge the experience, drop the file.**
PR #1's idle→working→result phase machine — calm "VERA is on it," plain-language step captions, "agents collapsed behind show-thinking," inline Approve/Tweak/Regenerate — *is* the create interaction and it ships. But it lands **inside the VERA thread** as the render for a pipeline run, not as a standalone `/generate` page (that route is retired). Two reconciliations are mandatory: (a) **re-skin onto design primitives** (Card for the draft, Button for verbs, SectionLabel/EmptyState for idle) — PR #1 used raw Tailwind; (b) **fix its Review-bypass** — "Approve" in-thread routes the post into Review's queue via approval-webhook, so judgment isn't split across two places.

**How central is the observation loop → IT IS THE SPINE, with an escape hatch.**
Per-client agenda is the Home masthead (today it only renders when rows exist and sits *below* an audit card — here it leads). Cross-client agenda is the workspace landing surface at `/`. The operator's day starts on "what does VERA want." But pages stay navigable: with only 3 signals shipped, we do **not** demote pages to summoned-only drawers (Spine 1's reckless bet — its own tradeoffs admit "if vera-notice is noisy, the entire product feels wrong"). Centered, not sole.

**iPad / responsiveness → COMMIT to a 3→2→1 collapse of the desk.**
This is a stated gap (whole app is desktop-first) and the project-hub framing is the cheap lever that fixes it, because the single-view `<Outlet/>` canvas (no in-canvas second nav) is what makes it tractable.
- **Desktop:** rail + canvas + right identity card.
- **Tablet/iPad:** right identity card collapses into a Home section + slide-over (it's glanceable context, not primary). Rail + canvas remain.
- **Phone:** rail becomes a bottom tab bar (Home · VERA · Review · Knowledge); the shelf moves into the workspace-switcher sheet; VERA goes full-height (the natural mobile shape for a thread). Review's board degrades to a status-filtered list; Measure's charts stack.

---

## 7. Sequenced build plan

Ordered so the **workflow spine lands first** and detail fills in. Each phase is independently shippable. Re-litigating the architecture is out of scope at every step.

**Already done — build on it, don't redo it:**
- Design system: `src/design/` — tokens + Button/Card/Chip/EmptyState/Field/PageHeader/SectionLabel/Toast.
- Dashboard refactor (on design primitives; live "VERA wants to" panel + vera-act wiring).
- Knowledge refactor (ingest → classify → suggest; richest agentic surface).
- Agentic loop shipped: `agent_observations` (migration 030), `vera-notice` (pg_cron 30min, walks all projects), `vera-act` (3 action kinds).
- `projects` table + `projects.instructions` column (migration 026) — exists, nothing writes it yet.

### Phase 0 — Routing skeleton + nav collapse *(the spine's bones; pure frontend)*
Make the two-altitude IA real before moving any feature logic.
- Add routes under `/p/:projectSlug`: `vera`, `brain`, `measure` (App.tsx lines 60-67 currently stop at `knowledge`). Keep `dashboard`→Home, `review`, `review/:id`, `knowledge`.
- Rewrite the rail (Layout.tsx ~519-524) to the six loop items: Home · VERA · Review · Knowledge · Brain · Measure. Point Audit/Intel into Measure tabs. **Delete the "More" drawer** (Layout.tsx ~661-678).
- Convert flat `/audit`, `/intel`, `/library`, `/clients`, `/calendar`, `/templates`, `/agency` to **redirect shims** into the project frame (or `/` for Agency) so bookmarks don't rot. Keep `/onboarding*` for first-ever signup only.
- `/` renders **Across Clients** (stub: list projects + a placeholder agenda).
**Ships:** the app's new shape. Nothing lost; everything still reachable.

### Phase 1 — One composer (VERA) + land PR #1 *(kills the two-composer problem)*
- Add a `run_pipeline` tool to `vera-chat` that streams `vera-orchestrator` into the thread.
- Build the **VERA** tab from the promoted ChatPanel (composer + stream + 18 tools + image paste), scoped per project (`chat_messages` already carries `project_id`).
- Port PR #1's DraftCard (idle→working→result + show-thinking + Approve/Tweak/Regenerate) **into the thread**, re-skinned on `src/design`. "Approve" → approval-webhook → Review queue. "Tweak" → regeneration request in-thread.
- **Delete `/generate`** and the Layout.tsx line 735 chat-hide hack. Remove the dock concept.
**Ships:** one conversational surface. "Two composers on one page" is now structurally impossible.

### Phase 2 — Project Home + Brain *(the desk comes alive; per-project config)*
- **Home:** promote observations to masthead; add the loop-status strip (counts derived from `content_posts.status` + `posted_at`); "Needs you" links into Review; right identity card (readiness pip + channels + This-week).
- **Brain:** new page writing `projects.instructions`; move **Brand Voice per-project** (out of Settings); first-class **Audiences** editor; **Channels** section (move PublishersCard here); make `content-audit`/`seo-audit` **re-runnable**.
- Wire Knowledge's per-doc `suggestion` → **Approve button → vera-act**; readiness pip flips green when voice+knowledge exist (clears `knowledge_gap`).
- **Migration:** add `project_id` to `brand_voice` / audiences scoping.
**Ships:** "each client is a project with its own instructions/knowledge/voice" becomes literally true.

### Phase 3 — Review as judgment home + first-class publish *(stage 4-5 polish)*
- Make Review's **board the default arrival view** (Brief·Draft·Review·Publish·Measure columns derived from status + `posted_at` + has-metrics). Ship columns scoped to **real states only**; add Brief/Measure columns once their data exists (Phase 5). Keep responsive 5-up→swipe→list collapse.
- Fold ReviewDetail into the detail panel; surface **all publish channels as equal first-class chips** (LinkedIn + 8 connectors), with inline `dry_run`/`verify`/health. Cut `/review/:id` route.
- Verbs everywhere: **Approve / Tweak / Kill**; Tweak routes to the VERA thread.
**Ships:** the operator's real job (taste + risk) gets a fast, complete home; the orphaned connector platform gets its due.

### Phase 4 — Across Clients agenda + visible vera-act *(the cross-client altitude)*
- `/` aggregates open `agent_observations` across all non-archived projects (query change — `vera-notice` already walks all projects; the open-index already exists), ranked severity→recency, each one-click Approve/Dismiss; per-client pulse row carries `agency_id` stats (absorbs Agency).
- **vera-act visible execution:** acting posts a live "VERA is drafting…" card that streams and resolves into a Draft Card in the relevant thread (replaces fire-and-navigate).
**Ships:** the operator's morning triage across the whole book — the day starts here.

### Phase 5 — Measure backend + the loop closes *(fills the one real hole)*
- **Migration:** add engagement columns to `content_posts` (impressions, reactions, comments, shares, fetched_at) + an ingest path (per-channel pull). **This is the gate — build columns first, render Measure second.**
- **Measure** page: per-project Audit tab (re-scoped LinkedInScore + Brew360) + Intel tab (per-project competitor timeline) + outcomes rollup. `seo-audit` surfaced as a second audit tab for non-LinkedIn clients (fixes "LinkedIn-shaped, not just B2B").
- Add **outcome-aware vera-notice signals** ("sensory posts +40% — lean in?", "this theme is dying"). Add Brief/Measure columns to Review's board now that data backs them.
**Ships:** `Publish → Measure → Notice → Brief` closes. VERA observes *outcomes*, not just gaps.

### Phase 6 — Remaining signals + orphan wiring *(depth, agent-first everywhere)*
- New signals: `connector_health`, `competitor_intel`, `craft` (self-improvement visible/approvable), `asana_brief`.
- Wire `generate-video` to a draft-card action; surface `generate-image`/`generate-infographic` on the draft card; expose `kb_synthesize`/`kb_audit_summary` on Knowledge.
- Skills → advanced tab of workspace Settings.
- Onboarding rework: "New client = open project"; LinkedIn audit becomes one optional grounding move (remove the `AuditRedirect` hard gate in App.tsx).
**Ships:** every orphaned high-value backend now reaches the operator, mostly *as a proposal* — the agent-first promise fully realized.

---

**Net after all phases:** one calm loop per client, many clients on a shelf; one VERA that drives, one operator who steers taste; no feature menu, no "More" drawer, no two composers, no LinkedIn-only assumption, and a closed measure→notice loop. Linear/Notion-calm, agent-first, multi-category. Execute Phase 0 → 6 in order. Do not re-open the architecture.
