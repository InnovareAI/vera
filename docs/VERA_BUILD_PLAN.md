# VERA Build Plan

Status: current execution plan.
Last updated: 2026-06-13.

## Product Definition

VERA is a B2B demand and content operating system. It is not just a content generator.

The core promise:

- Learn each client deeply from website, SEO structure, product pages, blog, LinkedIn, Instagram, YouTube, Medium, Quora, Reddit, Facebook, X, and supplied documents.
- Turn that knowledge into platform-native demand content.
- Publish or hand off only through the right client-owned connection, key, role, and approval path.
- Measure comments, shares, clicks, traffic, objections, buyer questions, and SAM handoff signals.
- Improve the next brief from what worked and what did not.

The operator experience should feel close to SAM: calm, agentic, scoped, and self-improving. VERA drives the loop. The operator steers taste, risk, and commercial judgment.

## Confirmed Product Direction

These decisions came from the June 13, 2026 product direction pass and should guide future build choices:

- VERA covers all supported organic channels, not only LinkedIn or blog.
- YouTube, Medium, Quora, Reddit, and potentially X belong in the channel model.
- The content scope is all content jobs that help the client create demand.
- Speaker mode is case based: sometimes one named person, sometimes the company, sometimes multiple voices.
- Approval routing is case based: sometimes one stakeholder, sometimes all required stakeholders.
- Core engagement means comments and shares, but the commercial outcome is qualified traffic and demand.
- VERA is a product InnovareAI will sell, so key isolation, provider spend, pricing controls, role boundaries, and client trust are product requirements, not internal implementation details.

## Moat

Generic social and content apps are easy to build. VERA's moat needs to come from the operating loop, not from having a post composer.

The moat is:

- Per-client knowledge that compounds.
- Medium-specific tone of voice, with one shared brand core.
- A self-learning content strategy layer that updates from observed outcomes.
- B2B top-of-funnel intent capture, not vanity content.
- SAM handoff, so comments, shares, objections, traffic, and named accounts become sales intelligence.
- Strict key, provider, and model entitlement rules, so clients cannot spend InnovareAI credits.
- Case-based approvals by person, channel, topic, claim risk, and stakeholder group.

## First-Wave Platforms

First wave means the platform is visible in integrations and planning now.

- Google Search Console: search queries, pages, indexing, SEO opportunities.
- Google Analytics 4: traffic, acquisition, conversion, landing pages.
- LinkedIn through Unipile: profiles, company pages, posts, events, newsletters where available.
- Meta: Facebook Pages and Instagram Professional.
- YouTube: channel and analytics first, upload later.
- WordPress and other CMS: publishing for approved long-form content.
- Medium: manual-first publishing and RSS ingestion.
- Quora: manual-first answer drafting and question research.
- Reddit: read-first listening, objection mining, and community-safe drafts.

X is Wave 2. It stays manual-first until the API cost and client plan justify deeper integration.

## Content Scope

VERA must support all content jobs, selected case by case:

- Campaigns.
- LinkedIn posts.
- Founder or expert posts.
- Company posts.
- Comments and replies.
- Carousels.
- Images.
- Video storyboards.
- Short clips.
- YouTube scripts and descriptions.
- Medium essays.
- Quora answers.
- Reddit research briefs.
- X POV tests.
- Blog and CMS articles.
- Email and newsletter drafts.
- SAM handoff briefs.

Speaker strategy is case based. Sometimes VERA writes as one named person. Sometimes it writes as the company. Sometimes it needs multiple stakeholder voices.

## Approval Model

Approval is also case based:

- Low-risk drafts can go to one named owner.
- Named-person posts should go to that person.
- Client-visible publishing needs the client-space approval path.
- Sensitive claims, regulated topics, legal risk, or high-value campaigns can require all stakeholders.
- VERA should recommend the approval path, but never bypass it.

## Measurement Model

The main engagement outcomes are:

- Comments.
- Shares.
- Saves.
- Clicks.
- Qualified traffic.
- Buyer questions.
- Objections.
- Warm accounts.
- Meeting requests.

These metrics should feed the learning loop. Performance is not a dashboard-only feature. It should change the next brief, the channel strategy, the recommended model, and the SAM handoff.

## Model And Cost Policy

VERA will be sold, so model economics need to be designed into the product.

Rules:

- Client spaces use client-owned keys by default.
- InnovareAI platform keys are never default for client generation.
- Platform keys require explicit operator entitlements and approved InnovareAI projects.
- VERA should recommend the cheapest model that is good enough for the task.
- Premium models are opt-in, visible, and explain why they are worth the cost.
- Image generation defaults to cheap and fast prototyping options.
- Premium image models are never default.
- Video generation is gated, storyboard-first, and never silently available to client users.

The model selector should eventually become a recommendation engine: task type, quality need, compliance need, speed, cost ceiling, and available client keys determine the model.

## UX Shape

Two altitudes:

- Shelf: across clients, all open work, risk, and opportunities.
- Desk: one client, one loop.

The client loop:

1. Onboard.
2. Learn.
3. Brief.
4. Draft.
5. Approve.
6. Publish or hand off.
7. Measure.
8. Learn and propose the next move.

Current app labels are allowed to be pragmatic:

- Command: VERA thread and action surface.
- Review: approval and judgment queue.
- Planner: scheduled content and campaign timing.
- Studio: content artifacts.
- Demand Brain: business context, tone, speakers, channels, approvals, and SAM handoff rules.
- Performance: measurement and source intelligence.
- Learning: self-improvement and reusable skills.
- Integrations: client-owned provider keys and channel connections.

## Build Sequence

1. Lock the commercial guardrails.
   - Client-owned provider keys.
   - Explicit platform media entitlements.
   - No default InnovareAI media spend for client users.
   - Cost-aware model recommendations.

2. Make Demand Brain the strategic center.
   - Company URL first.
   - Upload document extraction.
   - Pull website, SEO, product pages, blog, LinkedIn, Instagram, YouTube, Medium, Quora, Reddit, Facebook, and X where available.
   - Store platform tone, speaker strategy, approvals, outcome signals, and SAM handoff rules.

3. Make Command the doing surface.
   - Persistent chat history.
   - New session button.
   - Model comparison for drafts.
   - Storyboard-first video workflow.
   - Draft card actions for image, carousel, infographic, and video.

4. Make Review the judgment surface.
   - Platform-native previews.
   - Correct dimensions and comment fields.
   - Approve, tweak, reject, schedule, publish, and handoff.
   - Sticky views.

5. Make Performance close the loop.
   - Pull platform metrics where APIs allow it.
   - Support manual metrics for Medium, Quora, Reddit, and X.
   - Track comments, shares, clicks, traffic, and buyer-intent signals.
   - Turn results into recommended next briefs.

6. Build the self-learning layer.
   - Platform best practices in general KB.
   - Client-specific wins and failures in client KB.
   - Weekly recommendations.
   - Skill proposals that operators can approve.

7. Package for sale.
   - Workspace and client roles.
   - Invitations.
   - Client spaces.
   - Per-client integrations and API keys.
   - Billing-aware model limits.
   - Audit logs for generation, publishing, and provider spend.

## Next Product Slice

The active high-leverage slice is the model recommendation and entitlement layer:

- Text: recommend Gemini or other low-cost capable models through the client's configured provider where available.
- Image: cheap prototype default, premium only when selected.
- Video: storyboard first, gated by explicit video entitlement.
- UI: show why VERA picked a model and what it will cost before generation.

Current state:

- Command shows text, image, and video routing before generation.
- Command shows budget classes: no spend, low token cost, standard image, premium image, storyboard-only, standard video, or premium video risk.
- Command now adds provider-aware estimate guides for common text, image, and video routes. These are operator-facing planning estimates, not billing records.
- Command and client API-key settings share one frontend model economics module for labels, premium classification, model options, and planning estimates.
- Command and client API-key settings show whether estimates are using the live provider pricing catalog or the static fallback guide.
- A provider pricing catalog migration now defines normalized model pricing rows with RLS, explicit grants, reviewed dates, source URLs, and seeded text, image, and video guide rows.
- The provider pricing catalog is applied on the live Vera content stack at `supabase-content-eu.innovareai.com` and currently exposes 13 active read-only pricing rows through the anon REST API.
- Edge Function usage logging and client budget checks now try the provider pricing catalog first, then fall back to static estimates if the catalog is unavailable or no model row matches.
- AI Usage settings now includes an operator-only pricing catalog editor for platform admins, backed by a service-role Edge Function gated through `is_platform_admin`.
- A shared recommendation layer now chooses task-aware text, image, and video routes from provider readiness, selected defaults, premium policy, monthly cap state, and pricing catalog estimates.
- Client API-key settings now show the recommended text, image, and video route with model, provider, estimate, reason, and escalation rule.
- Command model routing now reuses the same recommendation rules, so chat guidance and API-key settings do not drift.
- Image readiness now checks whether the selected default image model can actually run through the active client key type. For example, an OpenAI key does not make Nano Banana ready.
- Image and video generation now resolve recommended defaults server-side when no explicit model is requested.
- Server-side image defaults avoid premium policy defaults and choose a standard model that can run on the client's active key route.
- Server-side video defaults stay on Hailuo or Hailuo I2V unless the operator explicitly requests and approves a premium model.
- Media usage logs now include the requested model, policy default, model selection source, and selection reason for spend audits.
- CMS/blog publishers are now scoped to client spaces through `publishers.project_id`; the UI only lists active-client publishers and the backend blocks cross-client publish attempts before credentials are loaded.
- Unipile publishing now requires a project-scoped client integration for project posts, blocks unapproved LinkedIn company-page overrides, and the review page sends real user JWTs to publish functions instead of the anon key.
- Weekly learning notices now have a durable review action path. Operators can enable proposed client skills, queue SAM handoff actions, and mark a weekly review complete from the VERA launcher.
- The weekly review action is backed by a scoped Edge Function that authorizes through `requireObservationMember` and derives org and project scope from the observation row, not from client-supplied request fields.
- The backend now includes `sam_handoff_actions`, a tenant-scoped table for content-to-sales handoff candidates with RLS, explicit grants, duplicate protection by project and post, assignment, handoff, completion, dismissal, and status tracking.
- The missing `agent_observations` create-table migration has been repaired for clean rebuilds while staying idempotent for production.
- Learning now includes a visible SAM handoff queue. Operators can queue detected demand signals, assign or reassign them, copy the brief for SAM, complete, dismiss, and reopen queue items.
- The video backend now re-verifies approved platform media project scope inside the final FAL key resolver, so platform FAL fallback cannot be enabled by a caller flag alone.
- Demand Brain now exposes per-channel operating policy for speaker mode, approval path, publishing guard, measurement focus, and SAM handoff trigger across the full organic channel set.
- Demand Brain channel policies are now client-editable, saved into project instructions, preserved by document extraction, and read by approval routing for review risk, checklists, and publishing guard context.
- Command now summarizes saved channel policies in the Demand plan and injects publishing guards plus SAM triggers into campaign, channel matrix, and handoff prompts.
- Review Detail now repeats the saved channel publishing guard and SAM trigger immediately before final publishing actions.
- Vera chat now uses the shared LinkedIn research resolver, so an InnovareAI operator profile can research across client spaces without granting client publishing rights.
- `ops/verify-media-key-scope.sh` now provides a no-spend production regression check that a client space without a FAL key cannot call a FAL-only image model through `generate-image`.
- Shared text runtimes now use the same model-selection audit metadata, including requested model, policy default, selection source, and selection reason.
- Client OpenRouter text defaults now fall back to Gemini Flash class when no client policy default is set.
- The legacy onboarding route now creates a client project under the active workspace instead of creating a new organization. It seeds the project Demand Brain with company URL, channels, default demand operating model, approval model, engagement signals, and SAM handoff rules, then lands the user in that client's Brain.
- The `/clients` shelf now uses the project-based Across Clients surface with a primary Add client action that opens the project-based onboarding flow. The obsolete organization-based Clients page has been removed to prevent future work from recreating tenant-per-client behavior.
- Obsolete standalone IA files have been removed for the old Dashboard, Generate page, ChatPanel dock, Intel page, Library page, Agency page, and Templates page. Legacy route shims now normalize into the current project desk sections, and project switching maps old flat routes like `/generate`, `/audit`, and `/templates` into VERA, Performance, and Knowledge.
- Demand Brain now renders a channel operating matrix from the saved client sources and channel strategy, showing each channel's role, publishing mode, workflow, source status, and outcome signals.
- AI Usage settings now filters current-month usage by model selection source: recommended, policy default, explicit override, fallback, or unknown historical events.
- Image and video generation now emit structured AI budget warnings before a paid provider call when a cap is missing, the request cost is unknown, or the request moves a client space near its monthly cap.
- Command surfaces those budget warnings as operator toasts, while usage logs keep the warning metadata for audits.
- Performance now supports manual lifetime metric entry for API-light channels and fallback cases, including Medium, Quora, Reddit, X, and any provider where sync is incomplete.
- Manual metrics capture views, reach, comments, shares, saves, clicks, qualified traffic, buyer questions, and meeting requests as normalized `content_metric_snapshots`.
- Learning now turns synced and manual metrics into demand insights, next experiment prompts, SAM handoff candidates, and buyer-intent weighted demand scores.
- Learning now proposes inactive, client-scoped skills from measured evidence, such as repeatable demand patterns, buyer-intent response loops, and qualified-traffic CTA tests.
- AI Settings now supports deep links into the Skills view so Learning can send operators straight to review and enable proposed client skills.
- The `vera-notice` worker now creates a weekly learning observation per client when there are fresh demand signals, pending learning skill proposals, approved unscheduled posts, or SAM handoff candidates.
- Weekly learning observations include current-week metrics, previous-week comparison, top assets, pending skill proposals, SAM handoff candidates, and a route back to the client Learning page.
- The VERA launcher now renders weekly learning observations as action cards with metrics, top assets, skill proposals, SAM handoff counts, and direct actions to Learning, AI Settings, and prefilled VERA briefs.

Next step:

- Keep tightening connector scope and demand-channel behavior: research can use approved operator profiles, while publishing, media generation, provider spend, and credentials stay client-scoped and entitlement-gated.
