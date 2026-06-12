import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { normalizePricingCatalogRows, type ModelPricingGuide, type ProviderModelPricingRow } from './modelEconomics'

export type ModelPricingCatalogSource = 'loading' | 'catalog' | 'fallback'

type ModelPricingCatalogState = {
  catalog: ModelPricingGuide[]
  loaded: boolean
  source: ModelPricingCatalogSource
  rowCount: number
  error: string | null
}

export function useModelPricingCatalog() {
  const [state, setState] = useState<ModelPricingCatalogState>({
    catalog: [],
    loaded: false,
    source: 'loading',
    rowCount: 0,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    supabase
      .from('provider_model_pricing')
      .select('provider, model_key, model_match_patterns, operation, billing_unit, input_per_million_usd, output_per_million_usd, unit_price_usd, estimate_label, estimate_detail, source, source_url, confidence, premium, reviewed_on')
      .eq('active', true)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setState({
            catalog: [],
            loaded: true,
            source: 'fallback',
            rowCount: 0,
            error: 'Pricing catalog unavailable. Vera is using fallback estimates.',
          })
        } else {
          const catalog = normalizePricingCatalogRows((data ?? []) as ProviderModelPricingRow[])
          setState({
            catalog,
            loaded: true,
            source: catalog.length ? 'catalog' : 'fallback',
            rowCount: catalog.length,
            error: catalog.length ? null : 'Pricing catalog has no active rows. Vera is using fallback estimates.',
          })
        }
      })
    return () => { cancelled = true }
  }, [])

  return state
}
