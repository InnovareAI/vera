import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "GET") return jsonError("Method not allowed", 405)

  const token = new URL(req.url).searchParams.get("token")?.trim()
  if (!token || !/^[a-f0-9]{32,128}$/i.test(token)) return jsonError("Invalid review token", 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: post, error } = await supabase
    .from("content_posts")
    .select("id,title,copy,format,channel,media_url,media_type,media_metadata,profile_name,profile_title,author,publish_date,status,hashtags,created_at,updated_at,review_token_expires_at,review_token_revoked_at")
    .eq("review_token", token)
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!post) return jsonError("Review link not found", 404)
  if (post.review_token_revoked_at) return jsonError("Review link revoked", 410)
  if (post.review_token_expires_at && new Date(post.review_token_expires_at).getTime() < Date.now()) {
    return jsonError("Review link expired", 410)
  }

  const { review_token_expires_at: _expires, review_token_revoked_at: _revoked, ...safePost } = post
  void _expires; void _revoked
  return new Response(JSON.stringify({ post: safePost }), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
})

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}
