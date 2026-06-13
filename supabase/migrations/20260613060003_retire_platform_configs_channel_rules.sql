-- Retire legacy workspace-level channel writing rules.
--
-- Channel tone, speaker mode, approval routing, publishing guards,
-- measurement focus, and SAM handoff rules now live in each client project's
-- Demand Brain via projects.instructions. Keeping platform_configs writable
-- would reintroduce org-wide leakage across client spaces.

ALTER TABLE IF EXISTS public.platform_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.platform_configs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_configs_anon_all" ON public.platform_configs;
DROP POLICY IF EXISTS "platform_configs_all" ON public.platform_configs;
DROP POLICY IF EXISTS "platform_configs_member_all" ON public.platform_configs;

REVOKE ALL ON TABLE public.platform_configs FROM anon;
REVOKE ALL ON TABLE public.platform_configs FROM authenticated;
REVOKE ALL ON TABLE public.platform_configs FROM service_role;

COMMENT ON TABLE public.platform_configs IS
  'Retired legacy org-wide channel writing rules. Use project Demand Brain channelOperatingPolicies instead.';
