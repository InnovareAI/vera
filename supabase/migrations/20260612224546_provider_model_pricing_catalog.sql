CREATE TABLE IF NOT EXISTS public.provider_model_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model_key text NOT NULL,
  model_match_patterns text[] NOT NULL DEFAULT ARRAY[]::text[],
  operation text NOT NULL,
  billing_unit text NOT NULL,
  input_per_million_usd numeric,
  output_per_million_usd numeric,
  unit_price_usd numeric,
  estimate_label text NOT NULL,
  estimate_detail text NOT NULL,
  source text NOT NULL,
  source_url text,
  confidence text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  premium boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  reviewed_on date NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model_key, operation)
);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS provider_model_pricing_lookup_idx
  ON public.provider_model_pricing(provider, operation, active);

CREATE INDEX IF NOT EXISTS provider_model_pricing_model_key_idx
  ON public.provider_model_pricing(model_key);

DROP TRIGGER IF EXISTS provider_model_pricing_updated_at ON public.provider_model_pricing;
CREATE TRIGGER provider_model_pricing_updated_at
  BEFORE UPDATE ON public.provider_model_pricing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.provider_model_pricing ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.provider_model_pricing FROM anon, authenticated;
GRANT SELECT ON public.provider_model_pricing TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_model_pricing TO service_role;

DROP POLICY IF EXISTS provider_model_pricing_public_select ON public.provider_model_pricing;
CREATE POLICY provider_model_pricing_public_select
  ON public.provider_model_pricing
  FOR SELECT
  USING (active = true);

INSERT INTO public.provider_model_pricing (
  provider,
  model_key,
  model_match_patterns,
  operation,
  billing_unit,
  input_per_million_usd,
  output_per_million_usd,
  unit_price_usd,
  estimate_label,
  estimate_detail,
  source,
  source_url,
  confidence,
  premium,
  active,
  reviewed_on,
  metadata
) VALUES
  (
    'google',
    'gemini-flash-class',
    ARRAY['gemini', 'flash'],
    'chat.message',
    'token',
    0.10,
    0.40,
    NULL,
    'Gemini Flash class',
    'Low-cost Gemini-class text routing guide. Actual provider markup and selected model can vary.',
    'google_gemini_api_pricing_2026_06_13',
    'https://ai.google.dev/gemini-api/docs/pricing',
    'medium',
    false,
    true,
    '2026-06-13',
    '{"estimate_input_tokens":4500,"estimate_output_tokens":1200}'::jsonb
  ),
  (
    'anthropic',
    'claude-haiku-class',
    ARRAY['haiku'],
    'chat.message',
    'token',
    1.00,
    5.00,
    NULL,
    'Claude Haiku class',
    'Low-cost Claude text route for simple drafting and classification.',
    'anthropic_pricing_2026_06_13',
    'https://platform.claude.com/docs/en/about-claude/pricing',
    'high',
    false,
    true,
    '2026-06-13',
    '{"estimate_input_tokens":4500,"estimate_output_tokens":1200}'::jsonb
  ),
  (
    'anthropic',
    'claude-sonnet-class',
    ARRAY['sonnet'],
    'chat.message',
    'token',
    3.00,
    15.00,
    NULL,
    'Claude Sonnet class',
    'Higher-quality Claude text route for strategy, copy judgment, and complex reasoning.',
    'anthropic_pricing_2026_06_13',
    'https://platform.claude.com/docs/en/about-claude/pricing',
    'high',
    false,
    true,
    '2026-06-13',
    '{"estimate_input_tokens":4500,"estimate_output_tokens":1200}'::jsonb
  ),
  (
    'anthropic',
    'claude-opus-class',
    ARRAY['opus'],
    'chat.message',
    'token',
    5.00,
    25.00,
    NULL,
    'Claude Opus class',
    'Premium Claude text route. Use only when task complexity justifies the cost.',
    'anthropic_pricing_2026_06_13',
    'https://platform.claude.com/docs/en/about-claude/pricing',
    'high',
    true,
    true,
    '2026-06-13',
    '{"estimate_input_tokens":4500,"estimate_output_tokens":1200}'::jsonb
  ),
  (
    'fal',
    'nano-banana',
    ARRAY['nano-banana', 'gemini-25-flash-image'],
    'image.generate',
    'image',
    NULL,
    NULL,
    0.039,
    '~$0.039 / image',
    'fal Nano Banana text-to-image guide.',
    'fal_nano_banana_pricing_2026_06_13',
    'https://fal.ai/models/fal-ai/nano-banana',
    'high',
    false,
    true,
    '2026-06-13',
    '{}'::jsonb
  ),
  (
    'fal',
    'nano-banana-2',
    ARRAY['nano-banana-2'],
    'image.generate',
    'image',
    NULL,
    NULL,
    0.08,
    '~$0.08 / image',
    'fal Nano Banana 2 guide. Higher resolution can cost more.',
    'fal_nano_banana_2_pricing_2026_06_13',
    'https://fal.ai/models/fal-ai/nano-banana-2',
    'high',
    false,
    true,
    '2026-06-13',
    '{}'::jsonb
  ),
  (
    'fal',
    'seedream',
    ARRAY['seedream', 'seedream-v4'],
    'image.generate',
    'image',
    NULL,
    NULL,
    0.03,
    '~$0.03 / image',
    'fal Seedream normalized image guide.',
    'fal_seedream_pricing_2026_06_13',
    'https://fal.ai/pricing',
    'medium',
    false,
    true,
    '2026-06-13',
    '{}'::jsonb
  ),
  (
    'fal',
    'seedream-v4.5',
    ARRAY['seedream-v4.5', 'seedream-4.5'],
    'image.generate',
    'image',
    NULL,
    NULL,
    0.03,
    '~$0.03 / image',
    'Use Seedream as the cheap prototype benchmark until live pricing is normalized.',
    'fal_seedream_pricing_2026_06_13',
    'https://fal.ai/pricing',
    'medium',
    false,
    true,
    '2026-06-13',
    '{}'::jsonb
  ),
  (
    'fal',
    'qwen-image',
    ARRAY['qwen-image', 'qwen'],
    'image.generate',
    'megapixel',
    NULL,
    NULL,
    0.02,
    '~$0.02 / MP',
    'fal Qwen guide, billed by output megapixel.',
    'fal_image_pricing_2026_06_13',
    'https://fal.ai/pricing',
    'medium',
    false,
    true,
    '2026-06-13',
    '{}'::jsonb
  ),
  (
    'fal',
    'hailuo',
    ARRAY['hailuo', 'minimax'],
    'video.submit',
    'video',
    NULL,
    NULL,
    0.28,
    '~$0.28 / 6s',
    'fal Hailuo 2.3 Standard text-to-video guide.',
    'fal_hailuo_2_3_standard_pricing_2026_06_13',
    'https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/text-to-video',
    'high',
    false,
    true,
    '2026-06-13',
    '{"duration_seconds":6}'::jsonb
  ),
  (
    'fal',
    'hailuo-i2v',
    ARRAY['hailuo-i2v', 'hailuo image-to-video', 'minimax image-to-video'],
    'video.submit',
    'video',
    NULL,
    NULL,
    0.27,
    '~$0.27 / 6s',
    'fal Hailuo 02 Standard image-to-video guide at 768p.',
    'fal_hailuo_02_standard_i2v_pricing_2026_06_13',
    'https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/image-to-video',
    'high',
    false,
    true,
    '2026-06-13',
    '{"duration_seconds":6}'::jsonb
  ),
  (
    'fal',
    'kling',
    ARRAY['kling'],
    'video.submit',
    'video',
    NULL,
    NULL,
    0.25,
    '~$0.25 to $0.90 / 5 to 10s',
    'Kling can climb quickly by tier and duration. Require approval before render.',
    'fal_kling_pricing_2026_06_13',
    'https://fal.ai/models/fal-ai/kling-video/v2.1/standard/image-to-video',
    'medium',
    true,
    true,
    '2026-06-13',
    '{"range_high_usd":0.90}'::jsonb
  ),
  (
    'fal',
    'seedance',
    ARRAY['seedance'],
    'video.submit',
    'video',
    NULL,
    NULL,
    0.26,
    '~$0.26+ / 5s',
    'Seedance pricing varies by version, resolution, audio, and endpoint. Require approval before render.',
    'fal_seedance_pricing_2026_06_13',
    'https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/text-to-video',
    'medium',
    true,
    true,
    '2026-06-13',
    '{"duration_seconds":5}'::jsonb
  )
ON CONFLICT (provider, model_key, operation) DO UPDATE SET
  model_match_patterns = EXCLUDED.model_match_patterns,
  billing_unit = EXCLUDED.billing_unit,
  input_per_million_usd = EXCLUDED.input_per_million_usd,
  output_per_million_usd = EXCLUDED.output_per_million_usd,
  unit_price_usd = EXCLUDED.unit_price_usd,
  estimate_label = EXCLUDED.estimate_label,
  estimate_detail = EXCLUDED.estimate_detail,
  source = EXCLUDED.source,
  source_url = EXCLUDED.source_url,
  confidence = EXCLUDED.confidence,
  premium = EXCLUDED.premium,
  active = EXCLUDED.active,
  reviewed_on = EXCLUDED.reviewed_on,
  metadata = EXCLUDED.metadata,
  updated_at = now();
