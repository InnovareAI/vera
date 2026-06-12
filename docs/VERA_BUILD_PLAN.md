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
- A provider pricing catalog migration now defines normalized model pricing rows with RLS, explicit grants, reviewed dates, source URLs, and seeded text, image, and video guide rows.
- Edge Function usage logging and client budget checks now try the provider pricing catalog first, then fall back to static estimates if the catalog is unavailable or no model row matches.

Next step:

- Apply the pricing catalog migration to the correct Vera Supabase project and move remaining static fallback rows into maintained provider pricing metadata.
