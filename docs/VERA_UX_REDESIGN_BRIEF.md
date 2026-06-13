# VERA UX Redesign Brief

Status: current UX direction.
Last updated: 2026-06-13.

This brief supersedes visual loyalty to the current alpha shell. The current app is useful as evidence of working workflows, data, and constraints. It is not a design constraint if a stronger product shape emerges.

## North Star

VERA should feel like a serious content growth operating desk, not an AI wrapper.

The product should help operators and clients answer five questions quickly:

1. What does VERA know about this client?
2. What should we create next, and why?
3. What is ready for human judgment?
4. What can be published safely, through the right account and key?
5. What did we learn that should change the next brief?

Chat is one control surface. The product is the operating loop around strategy, production, approval, publishing, measurement, and learning.

## Users

- InnovareAI operator: manages multiple client spaces, research, content strategy, production, model spend, and publishing readiness.
- Client owner: reviews strategy assumptions, approves content, comments on drafts, and confirms brand or risk boundaries.
- Client contributor: reviews named-person posts, supplies knowledge, and validates tone.
- Workspace admin: manages roles, invites, integrations, provider keys, usage, and budget policy.

## Product Jobs

- Onboard a client from URL, documents, and connected sources.
- Build and inspect a client Brain before content generation.
- Generate content from strategy, source evidence, channel policy, and approval rules.
- Compare model output without hiding provider cost or quality tradeoffs.
- Create platform-native post previews with correct dimensions, comments, media, and channel affordances.
- Route approval by person, channel, topic, claim risk, and stakeholder group.
- Publish or hand off only through client-scoped credentials.
- Pull metrics, support manual metrics, and turn outcomes into next actions.
- Let VERA learn continuously, but keep changes inspectable and approval-gated.

## Non-Negotiable UX Principles

### Strategy Before Generation

The product should not open with a generic prompt box as the main promise. The default state should show the client's strategy context, active channels, missing source evidence, open approvals, and VERA's next recommendation.

### AI Is Visible, But Not Decorative

Do not use sparkle-heavy language, fake magic, gradient AI decoration, or vague "generate better content" claims. When VERA acts, show the task, sources, model route, cost class, confidence, and approval requirement.

### The Brain Must Be Inspectable

Users need to see and edit what VERA knows:

- Company URL and source URLs.
- Active channels.
- Audience and customer problems.
- Offer and differentiators.
- Tone of voice by platform or medium.
- Speaker strategy.
- Approval model.
- Publishing guards.
- Measurement signals.
- SAM handoff triggers.
- Learning cadence.

If VERA learned something from a document or source pull, the user should be able to see where it came from and approve or reject it.

### One Doing Surface

Command, currently `/p/:slug/vera`, is the only conversational doing surface. It can create drafts, compare models, run research, generate media, and brief next actions. Other pages are for judgment, planning, memory, measurement, and administration.

### Platform-Native Judgment

Review must show content as the platform-specific object it will become:

- LinkedIn personal and company posts.
- Instagram image, carousel, and Reel previews.
- Facebook Page posts.
- YouTube title, description, thumbnail, chapters, Shorts ideas, and comment surface.
- Blog or CMS article structure.
- Medium article handoff.
- Quora answer format.
- Reddit research and draft format, read-first unless explicitly approved.
- X manual-first POV draft.

The reviewer should not approve generic text. They approve the real platform-shaped artifact.

### Spend And Model Choice Are Product Surfaces

Model choice is not an implementation detail. VERA should recommend a model based on:

- Task type.
- Quality need.
- Speed.
- Cost ceiling.
- Available client keys.
- Premium policy.
- Compliance sensitivity.
- Whether storyboard-first is required.

Premium image or video models should never become the silent default. Video must stay storyboard-first unless the user has explicit entitlement and approved spend.

### Human Judgment Is A Feature

Approvals, rejections, comments, and tweak requests are part of the value. They are not friction to hide. The UI should make human judgment fast, structured, and reusable by VERA.

### Learning Must Be Concrete

"Self-learning" needs visible objects:

- Winning and losing patterns.
- Channel-specific tone changes.
- Next experiment prompts.
- Skill proposals.
- SAM handoff candidates.
- Weekly review observations.
- Source gaps and stale assumptions.

Learning should change the next brief, not just decorate Performance.

### Client Scope Must Be Obvious

The active client, active channels, connected accounts, provider keys, and spend policy must always be clear. Users should never wonder which client they are generating for or which account will publish.

## Information Architecture

VERA has two altitudes.

### Shelf

The workspace-level view is for cross-client triage:

- VERA agenda across client spaces.
- Open review bottlenecks.
- Integration and key health.
- Weekly learning items.
- SAM handoff candidates.
- Client management, invites, roles, and access.

Near term, `/clients` carries this surface. Final target can make `/` the shelf once the cross-client agenda is strong enough.

### Desk

The client-level view is one client operating loop:

- Command: VERA thread, briefs, research, generation, model comparison, media actions.
- Review: approval queue, platform-native previews, comments, approval state.
- Planner: calendar, campaigns, workload, unscheduled content.
- Studio: generated assets, posts, artifacts, reusable campaign materials.
- Strategy Brain: client context, knowledge, channels, tone, approvals, policy.
- Performance: metrics, source intelligence, manual metrics, channel learning.
- Learning: self-improvement, skill proposals, SAM handoff queue.
- Integrations: client provider keys, OAuth accounts, publishers, budget policy.

## Screen Contracts

### Command

Command should show:

- Current client and session.
- New session action.
- Brain readiness and active channel summary.
- VERA's recommended next move.
- Attachments for documents and images.
- Model recommendation and cost class before generation.
- Model comparison when useful.
- Draft cards with platform target, source evidence, and approval action.
- Storyboard-first video flow.

Command should not become a blank chatbot with a few shortcut pills.

### Strategy Brain

Brain should show:

- Company URL first.
- Source ingestion and pull depth.
- Active channel selector.
- Business context.
- Platform tone and operating policy.
- Approval and publishing guards.
- Knowledge suggestions awaiting approval.
- What VERA learned recently and what is still uncertain.

Brain is the source of strategic truth. Settings should not duplicate it.

### Review

Review should show:

- Status and approval stage.
- Platform-native preview.
- Media attachments.
- Comment field and decision history.
- Approve, tweak, reject, schedule, publish, and handoff actions.
- Risk and approval route.
- Publishing guard and SAM trigger for the selected platform.

### Planner

Planner should show:

- Day, week, and month calendar controls inside the calendar surface.
- Campaign and workload overlays.
- Unscheduled approved content as a warning state.
- Platform and owner filters.
- Drag or schedule actions that actually persist.

### Performance

Performance should show:

- Content outcomes by channel, campaign, format, and speaker.
- Comments, shares, saves, clicks, qualified traffic, buyer questions, objections, and meetings.
- Manual metrics for API-light channels.
- Search Console and GA4 owned-site signals.
- What VERA recommends changing next.

Performance is not just a dashboard. It feeds the next brief.

### Learning

Learning should show:

- What patterns VERA believes work.
- Evidence behind each belief.
- Skill proposals waiting for approval.
- Handoff candidates.
- Weekly review actions.
- What VERA will test next.

## Visual Direction

The app should feel:

- Calm.
- Dense.
- Operational.
- Premium.
- Keyboard-friendly.
- Client-safe.
- Evidence-led.

Avoid:

- AI sparkle decoration.
- Blue generic CTAs.
- Oversized marketing hero layouts inside the app.
- Empty prompt-first home screens.
- Generic card farms.
- Decorative gradients, orbs, and bokeh.
- Hidden model spend.
- Duplicate places to approve or generate.

Accent color should be sparse. Status color should communicate state, not decorate.

## Redesign Tracks To Mock Up After Brief Confirmation

These are not final visual directions yet. They are the three tracks to explore once the design brief is confirmed.

1. Operating Desk: a dense agency command center, strongest for multi-client operators.
2. Strategy Canvas: Brain-first, strongest for onboarding, strategy confidence, and client trust.
3. Production Room: artifact-first, strongest for content creation, review, media, and publishing.

Each mockup must show at least:

- Active client.
- VERA recommendation.
- Brain readiness.
- Active channels.
- A content draft or review object.
- Model or spend signal.
- Approval path.
- Learning signal.

## First Build Slice After Mockups

The first redesign implementation should not rebuild the whole app. It should prove the new product shape through one high-traffic route.

Recommended first slice:

1. Redesign Command idle state as the real client desk entry point.
2. Surface Brain readiness, active channels, model route, spend class, and VERA agenda above the composer.
3. Keep the composer useful, but no longer let it dominate the empty state.
4. Add one draft card pattern that can move to Review with platform-native context.
5. Verify desktop and mobile layouts in the in-app browser.

This slice aligns the app with the new direction while preserving the working backend, client scoping, model routing, and existing review flow.

