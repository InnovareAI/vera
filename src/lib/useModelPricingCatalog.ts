import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { normalizePricingCatalogRows, type ModelPricingGuide, type ProviderModelPricingRow } from './modelEconomics'

export function useModelPricingCatalog() {
  const [catalog, setCatalog] = useState<ModelPricingGuide[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('provider_model_pricing')
      .select('provider, model_key, model_match_patterns, operation, billing_unit, input_per_million_usd, output_per_million_usd, unit_price_usd, estimate_label, estimate_detail, source, source_url, confidence, premium, reviewed_on')
      .eq('active', true)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setCatalog([])
        } else {
          setCatalog(normalizePricingCatalogRows((data ?? []) as ProviderModelPricingRow[]))
        }
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  return { catalog, loaded }
}
