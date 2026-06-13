-- Workflow fields for the visible SAM handoff queue.

ALTER TABLE public.sam_handoff_actions
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS handed_to_sam_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE INDEX IF NOT EXISTS sam_handoff_actions_assigned_to_idx
  ON public.sam_handoff_actions(assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS sam_handoff_actions_status_updated_idx
  ON public.sam_handoff_actions(project_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sam_handoff_actions_project_post_key
  ON public.sam_handoff_actions(project_id, post_id)
  WHERE post_id IS NOT NULL;
