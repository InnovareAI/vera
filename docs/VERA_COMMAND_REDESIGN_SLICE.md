# VERA Command Redesign Slice

Status: implementation map.
Last updated: 2026-06-13.

This document converts the UX redesign brief into the first executable code slice. It is intentionally scoped to Command (`/p/:slug/vera`) so VERA can start feeling like a content growth operating desk without a full app rebuild.

## Goal

Redesign the empty Command state so it is no longer a prompt-first chatbot screen.

The first screen should answer:

- Is this client ready to create?
- Which channels are strategy-valid?
- What does VERA recommend next?
- Which models and spend class will be used?
- What needs human judgment?
- Where does the operator act?

The composer remains important, but it should sit inside the operating desk, not dominate it.

## Current Code Map

Primary file:

- `src/pages/VeraThread.tsx`

Relevant surfaces:

- `Idle(...)`: empty Command state. Today it renders hero, composer, model routing, strategy plan, VERA agenda, and shortcut chips in that order.
- `renderComposer('idle')`: large composer, supports images and documents.
- `DemandPlanPanel(...)`: Strategy Brain summary, readiness, channels, speakers, tone, formats, signals, approvals, policy, learning, and prompt actions.
- `ModelRoutingPanel(...)`: provider key status, pricing source, generation cap, recommended text/image/video routes.
- `ProviderCapabilityNotice(...)`: locked text, image, and video notices.
- `WeeklyLearningNoticeCard(...)`: weekly learning actions, skills, SAM handoffs, next brief.
- `useEffect` around Brain readiness: computes setup state from business context, audiences, voice, categories, and knowledge.
- `buildDemandPlanSnapshot(...)`: derives strategy plan from project instructions and Demand Brain fields.

Important data already exists:

- `activeProject`
- `setup`
- `providerCapabilities`
- `pricingCatalog`, `pricingSource`, `pricingRowCount`
- `demandPlan`
- `observations`
- `stats`
- `attachments`
- `send(...)`
- `onOpenBrain`, `onOpenLearning`, `onAddKey`

## Target Empty-State Hierarchy

Replace the current centered hero stack with a desk layout.

Recommended order:

1. Client operating header.
2. VERA recommendation and agenda.
3. Readiness and channel strip.
4. Composer.
5. Model and spend strip.
6. Strategy summary.
7. Quick action chips.

### 1. Client Operating Header

Show:

- Client name.
- Readiness percent or setup state.
- Active channels count.
- Provider status.
- Generation guard status.
- New session action stays visible.

Implementation source:

- `projectName`
- `demandPlan.completeness`
- `demandPlan.channels`
- `providerCapabilities`

### 2. VERA Recommendation And Agenda

Use observations before generic shortcuts.

If open observations exist:

- Show one primary recommendation.
- Show supporting agenda items below or beside it.
- Weekly learning observations use `WeeklyLearningNoticeCard`.
- Other observations keep the action and dismiss controls.

If no observations exist:

- Show a generated fallback based on `demandPlan.missing`, `stats.pending`, and `providerCapabilities`.
- Examples:
  - "Finish the Brain before generating for this client."
  - "Review pending content before starting another batch."
  - "Add a provider key before paid generation."
  - "Plan the next channel batch from the saved Strategy Brain."

Implementation source:

- `observations`
- `setup`
- `stats`
- `providerCapabilities`
- `demandPlan.missing`

### 3. Readiness And Channel Strip

This should be a compact operating strip, not a large card.

Show:

- Brain readiness.
- Sources connected.
- Active channels.
- Custom policies.
- High-care channels.

Implementation source:

- `setup`
- `demandPlan.completeness`
- `demandPlan.sourceCount`
- `demandPlan.sourceTotal`
- `demandPlan.channels`
- `demandPlan.customPolicyCount`
- `demandPlan.highCareCount`

### 4. Composer

Composer should stay powerful:

- Documents.
- Images.
- Drag and drop.
- Large enough to brief a task.
- Clear send action.

But it should no longer be visually treated as the only product.

Implementation source:

- Existing `renderComposer('idle')`.

Refactor:

- Let `renderComposer` accept a `compactDesk` or similar option if needed.
- Keep current attachment behavior untouched.
- Preserve keyboard send behavior.

### 5. Model And Spend Strip

`ModelRoutingPanel` is useful but too large for the top of Command.

First slice should create a compact summary above or beside the composer:

- Text route.
- Image route.
- Video route.
- Budget guard status.
- Pricing catalog status.
- Provider keys action.

The full `ModelRoutingPanel` can remain collapsible or lower on the page.

Implementation source:

- `buildModelRecommendations(...)`
- `providerCapabilities`
- `pricingCatalog`
- `pricingSource`
- `pricingRowCount`
- `latestPricingReviewDate(...)`

### 6. Strategy Summary

Keep `DemandPlanPanel`, but reduce visual dominance in the first viewport.

First slice can:

- Rename visual heading to "Client strategy".
- Keep channel and policy clusters.
- Keep actions: Plan campaign, Channel matrix, Follow-up plan.
- Move it below the composer and agenda.

### 7. Quick Action Chips

Shortcut chips should become secondary.

Keep:

- Set up client.
- Draft content.
- Improve campaign.
- Plan channel matrix.
- Follow-up plan.

Do not let shortcut chips compete with the agenda or composer.

## Acceptance Criteria

- Empty Command state no longer reads as "large chatbot with shortcut pills."
- The first viewport shows client readiness, channels, VERA agenda, and model or spend state.
- The composer still supports text, images, documents, drag/drop, and keyboard submit.
- Locked media and missing provider keys remain clear.
- VERA agenda actions still work.
- Brain, Learning, Skills, and Provider key links still route correctly.
- Existing chat sessions and New session behavior still work.
- No provider key, media entitlement, or budget behavior changes.
- Desktop layout does not overlap at 1280px width.
- Mobile layout stacks without clipping long text.

## Suggested Implementation Steps

1. Extract small presentational components from `Idle`:
   - `CommandDeskHeader`
   - `CommandAgendaPanel`
   - `CommandReadinessStrip`
   - `CommandModelSpendStrip`
   - `CommandQuickActions`
2. Keep all data loading inside `VeraThread`.
3. Replace the centered `Idle` hero layout with a max-width desk grid.
4. Keep `DemandPlanPanel`, `ModelRoutingPanel`, and `ProviderCapabilityNotice` behavior intact during the first pass.
5. Run:
   - `npm run build`
   - Browser check on `/p/:slug/vera` while authenticated.
6. Only after visual approval, consider deeper route or IA changes.

## Product Design Gate

Before visual mockups or implementing the redesigned layout, the redesign brief needs explicit confirmation.

Brief to confirm:

> VERA becomes a serious content growth operating desk. Command is the doing surface, but the first screen is client readiness, VERA agenda, active channels, model and spend state, and then the composer. The current alpha shell can be changed heavily if a better solution emerges.

