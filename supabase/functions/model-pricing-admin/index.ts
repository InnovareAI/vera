import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import { jsonError, requireSignedInOrService } from "../_shared/auth.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type PricingAdminBody = {
  action?: unknown
  id?: unknown
  patch?: unknown
  row?: unknown
}

type PricingPatch = {
  provider?: string
  model_key?: string
  model_match_patterns?: string[]
  operation?: "chat.message" | "image.generate" | "video.submit"
  billing_unit?: "token" | "image" | "megapixel" | "video" | "quote"
  input_per_million_usd?: number | null
  output_per_million_usd?: number | null
  unit_price_usd?: number | null
  estimate_label?: string
  estimate_detail?: string
  source?: string
  source_url?: string | null
  confidence?: "high" | "medium" | "low"
  premium?: boolean
  active?: boolean
  reviewed_on?: string
  metadata?: Record<string, unknown>
}

const OPERATIONS = new Set(["chat.message", "image.generate", "video.submit"])
const BILLING_UNITS = new Set(["token", "image", "megapixel", "video", "quote"])
const CONFIDENCE = new Set(["high", "medium", "low"])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function createAdminClient() {
  return createClient<any>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return jsonError("Method not allowed", 405, cors)

  const supabase = createAdminClient()
  const auth = await requireSignedInOrService(req, supabase, SUPABASE_SERVICE_ROLE_KEY, cors)
  if (!auth.ok) return auth.response

  if (!auth.service) {
    if (!auth.userId) return jsonError("Unauthorized", 401, cors)
    const { data: isAdmin, error } = await supabase.rpc("is_platform_admin", { p_user: auth.userId })
    if (error) return jsonError("Could not verify operator access", 500, cors)
    if (isAdmin !== true) return jsonError("Forbidden", 403, cors)
  }

  const body = await readBody(req)
  if (!body.ok) return jsonError(body.error, 400, cors)

  const action = cleanString(body.value.action) || "list"
  try {
    if (action === "list") return json({ rows: await listRows(supabase) })

    if (action === "update") {
      const id = cleanString(body.value.id)
      if (!id || !UUID_RE.test(id)) return jsonError("A valid row id is required", 400, cors)
      const patch = sanitizePatch(body.value.patch, false)
      if (!patch.ok) return jsonError(patch.error, 400, cors)
      if (Object.keys(patch.value).length === 0) return jsonError("No supported fields to update", 400, cors)

      const { data, error } = await supabase
        .from("provider_model_pricing")
        .update(patch.value)
        .eq("id", id)
        .select("*")
        .maybeSingle()
      if (error) return jsonError(error.message, 500, cors)
      if (!data) return jsonError("Pricing row not found", 404, cors)
      return json({ row: data, rows: await listRows(supabase) })
    }

    if (action === "upsert") {
      const row = sanitizePatch(body.value.row, true)
      if (!row.ok) return jsonError(row.error, 400, cors)
      const { data, error } = await supabase
        .from("provider_model_pricing")
        .upsert(row.value, { onConflict: "provider,model_key,operation" })
        .select("*")
        .maybeSingle()
      if (error) return jsonError(error.message, 500, cors)
      return json({ row: data, rows: await listRows(supabase) })
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Pricing catalog request failed", 500, cors)
  }

  return jsonError("Unsupported action", 400, cors)
})

async function listRows(supabase: ReturnType<typeof createAdminClient>) {
  const { data, error } = await supabase
    .from("provider_model_pricing")
    .select("*")
    .order("provider", { ascending: true })
    .order("operation", { ascending: true })
    .order("model_key", { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

async function readBody(req: Request): Promise<{ ok: true; value: PricingAdminBody } | { ok: false; error: string }> {
  try {
    const value = await req.json()
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Invalid JSON body" }
    return { ok: true, value: value as PricingAdminBody }
  } catch {
    return { ok: false, error: "Invalid JSON body" }
  }
}

function sanitizePatch(value: unknown, requireIdentity: boolean): { ok: true; value: PricingPatch } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Patch must be an object" }
  const raw = value as Record<string, unknown>
  const out: PricingPatch = {}

  for (const key of ["provider", "model_key", "estimate_label", "estimate_detail", "source"] as const) {
    if (key in raw) {
      const normalized = boundedString(raw[key], key, key === "estimate_detail" ? 1000 : 160)
      if (!normalized.ok) return normalized
      out[key] = normalized.value
    }
  }

  if ("source_url" in raw) {
    const normalized = nullableUrl(raw.source_url)
    if (!normalized.ok) return normalized
    out.source_url = normalized.value
  }

  if ("model_match_patterns" in raw) {
    const patterns = stringArray(raw.model_match_patterns, "model_match_patterns", 30, 120)
    if (!patterns.ok) return patterns
    out.model_match_patterns = patterns.value
  }

  if ("operation" in raw) {
    const operation = cleanString(raw.operation)
    if (!operation || !OPERATIONS.has(operation)) return { ok: false, error: "Unsupported operation" }
    out.operation = operation as PricingPatch["operation"]
  }

  if ("billing_unit" in raw) {
    const billingUnit = cleanString(raw.billing_unit)
    if (!billingUnit || !BILLING_UNITS.has(billingUnit)) return { ok: false, error: "Unsupported billing unit" }
    out.billing_unit = billingUnit as PricingPatch["billing_unit"]
  }

  if ("confidence" in raw) {
    const confidence = cleanString(raw.confidence)
    if (!confidence || !CONFIDENCE.has(confidence)) return { ok: false, error: "Unsupported confidence" }
    out.confidence = confidence as PricingPatch["confidence"]
  }

  for (const key of ["input_per_million_usd", "output_per_million_usd", "unit_price_usd"] as const) {
    if (key in raw) {
      const parsed = nullablePrice(raw[key], key)
      if (!parsed.ok) return parsed
      out[key] = parsed.value
    }
  }

  for (const key of ["premium", "active"] as const) {
    if (key in raw) {
      if (typeof raw[key] !== "boolean") return { ok: false, error: `${key} must be boolean` }
      out[key] = raw[key]
    }
  }

  if ("reviewed_on" in raw) {
    const reviewedOn = cleanString(raw.reviewed_on)
    if (!reviewedOn || !DATE_RE.test(reviewedOn) || Number.isNaN(Date.parse(`${reviewedOn}T00:00:00Z`))) {
      return { ok: false, error: "reviewed_on must be YYYY-MM-DD" }
    }
    out.reviewed_on = reviewedOn
  }

  if ("metadata" in raw) {
    if (!raw.metadata || typeof raw.metadata !== "object" || Array.isArray(raw.metadata)) return { ok: false, error: "metadata must be an object" }
    out.metadata = raw.metadata as Record<string, unknown>
  }

  if (requireIdentity) {
    for (const key of ["provider", "model_key", "operation", "billing_unit", "estimate_label", "estimate_detail", "source", "reviewed_on"] as const) {
      if (!(key in out)) return { ok: false, error: `${key} is required for upsert` }
    }
  }

  return { ok: true, value: out }
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function boundedString(value: unknown, label: string, max: number): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = cleanString(value)
  if (!normalized) return { ok: false, error: `${label} is required` }
  if (normalized.length > max) return { ok: false, error: `${label} is too long` }
  return { ok: true, value: normalized }
}

function nullableUrl(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null }
  const normalized = cleanString(value)
  if (normalized.length > 500) return { ok: false, error: "source_url is too long" }
  try {
    const parsed = new URL(normalized)
    if (!["http:", "https:"].includes(parsed.protocol)) return { ok: false, error: "source_url must be http or https" }
    return { ok: true, value: parsed.toString() }
  } catch {
    return { ok: false, error: "source_url must be a valid URL" }
  }
}

function stringArray(value: unknown, label: string, maxItems: number, maxLength: number): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: `${label} must be an array` }
  if (value.length > maxItems) return { ok: false, error: `${label} has too many items` }
  const strings = value.map(item => cleanString(item)).filter(Boolean)
  if (strings.some(item => item.length > maxLength)) return { ok: false, error: `${label} contains an item that is too long` }
  return { ok: true, value: Array.from(new Set(strings)) }
}

function nullablePrice(value: unknown, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100000) {
    return { ok: false, error: `${label} must be a positive number or null` }
  }
  return { ok: true, value }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}
