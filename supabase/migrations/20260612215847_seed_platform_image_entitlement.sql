-- Seed InnovareAI operator access for platform-backed image rendering.
-- Client spaces still need their own media keys unless the project is an
-- approved platform media project and the operator has this entitlement.

INSERT INTO public.ai_user_entitlements (user_id, capability, note, granted_by)
SELECT u.id, 'platform_fal_image', 'Initial InnovareAI operator access for platform image rendering.', u.id
FROM auth.users u
WHERE lower(u.email) IN ('tl@innovareai.com', 'tl@innvoareai.com')
ON CONFLICT DO NOTHING;
