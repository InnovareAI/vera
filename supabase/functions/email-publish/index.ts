// Email auto-publish via Postmark.
//
// POST { post_id, recipients, from_email?, from_name?, reply_to?, auto_mark_posted? }
//   - post_id:        content_posts row to send
//   - recipients:     string (single email) or string[] (newsletter blast)
//   - from_email:     optional override; defaults to POSTMARK_FROM_EMAIL env
//   - from_name:      optional override; defaults to POSTMARK_FROM_NAME env
//   - reply_to:       optional Reply-To address
//   - auto_mark_posted: default true; chains back to approval-webhook on success.
//
// The writer agent produces email-channel post.copy in the shape:
//   Subject: <subject line>
//
//   <body>
// We parse that here, with a fallback to using post.title as subject if the
// "Subject:" prefix isn't present.
//
// Posted URL: emails don't have a public landing page, so we synthesise a
// mailto: link with the recipient list as a placeholder for the posted_url
// field. The Slack notify message will be friendlier than the link itself.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js"
import { requireSignedInOrService } from "../_shared/auth.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const POSTMARK_API_KEY = Deno.env.get("POSTMARK_API_KEY")
const POSTMARK_FROM_EMAIL = Deno.env.get("POSTMARK_FROM_EMAIL") ?? "hello@innovareai.com"
const POSTMARK_FROM_NAME  = Deno.env.get("POSTMARK_FROM_NAME")  ?? "InnovareAI"
const POSTMARK_MESSAGE_STREAM = Deno.env.get("POSTMARK_MESSAGE_STREAM") ?? "outbound"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "POST") return jsonError("Method not allowed", 405)
  if (!POSTMARK_API_KEY) return jsonError("POSTMARK_API_KEY not configured on the server.", 500)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const auth = await requireSignedInOrService(req, supabase, SUPABASE_SERVICE_ROLE_KEY, corsHeaders)
  if (!auth.ok) return auth.response

  const post_id = body.post_id as string | undefined
  const rawRecipients = body.recipients
  const fromEmail = (body.from_email as string | undefined) ?? POSTMARK_FROM_EMAIL
  const fromName  = (body.from_name  as string | undefined) ?? POSTMARK_FROM_NAME
  const replyTo   = body.reply_to    as string | undefined
  const autoMarkPosted = body.auto_mark_posted !== false

  if (!post_id) return jsonError("post_id is required", 400)
  if (!rawRecipients) return jsonError("recipients is required (email string or array)", 400)

  const recipients = (Array.isArray(rawRecipients) ? rawRecipients : [rawRecipients])
    .map(r => String(r).trim())
    .filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
  if (!recipients.length) return jsonError("No valid email addresses in recipients", 400)
  if (recipients.length > 100) return jsonError("Too many recipients (max 100 per send)", 400)

  // 1. Fetch the post
  const { data: post, error: postErr } = await supabase
    .from("content_posts")
    .select("id, channel, title, copy, posted_at")
    .eq("id", post_id)
    .maybeSingle()
  if (postErr) return jsonError(`Post lookup failed: ${postErr.message}`, 500)
  if (!post) return jsonError(`No post with id ${post_id}`, 404)
  if (post.posted_at) return jsonError("Post is already marked posted; refusing to re-send.", 409)
  if ((post.channel ?? "").toLowerCase() !== "email") {
    return jsonError(`email-publish only handles email posts; got channel='${post.channel}'`, 400)
  }

  // 2. Parse subject + body from the writer-shaped copy
  const parsed = parseEmailCopy(post.copy as string, post.title as string | undefined)
  if (!parsed.subject) return jsonError("Could not extract a subject — first line should be 'Subject: ...' or post must have a title.", 400)
  if (!parsed.body) return jsonError("Post has no body content.", 400)

  // 3. Send via Postmark. For single recipient → /email; multi → /email/batch.
  const sendResults: Array<{ recipient: string; message_id?: string; error?: string }> = []
  if (recipients.length === 1) {
    const res = await postmarkSend(recipients[0], fromEmail, fromName, replyTo, parsed.subject, parsed.body)
    sendResults.push(res)
  } else {
    const batchResults = await postmarkSendBatch(recipients, fromEmail, fromName, replyTo, parsed.subject, parsed.body)
    sendResults.push(...batchResults)
  }

  const successes = sendResults.filter(r => r.message_id)
  const failures = sendResults.filter(r => !r.message_id)

  if (!successes.length) {
    return jsonError(
      `Postmark rejected all ${recipients.length} sends. First error: ${failures[0]?.error ?? "unknown"}`,
      502,
    )
  }

  // 4. Posted URL — synthesise a mailto: with the (capped) recipient list.
  //    Keeps the posted_url column populated so existing UI surfaces work;
  //    the Slack notify uses the more human "sent to N recipients" wording.
  const mailtoRecipients = recipients.slice(0, 5).join(",") +
    (recipients.length > 5 ? `,+${recipients.length - 5}-more` : "")
  const postedUrl = `mailto:${mailtoRecipients}?subject=${encodeURIComponent(parsed.subject)}`

  // 5. Chain back to approval-webhook for posted_at + Slack notify
  if (autoMarkPosted) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/approval-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ post_id, action: "posted", posted_url: postedUrl }),
      })
    } catch (e) {
      console.error("approval-webhook chain failed after successful email send", e)
    }
  }

  return new Response(JSON.stringify({
    success: true,
    subject: parsed.subject,
    sent_count: successes.length,
    failed_count: failures.length,
    failures: failures.length ? failures : undefined,
    posted_url: postedUrl,
    recipients_sample: recipients.slice(0, 5),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Postmark
// ──────────────────────────────────────────────────────────────────────────────

interface PostmarkResponse {
  MessageID?: string
  ErrorCode?: number
  Message?: string
  To?: string
}

async function postmarkSend(
  to: string, fromEmail: string, fromName: string, replyTo: string | undefined,
  subject: string, body: string,
): Promise<{ recipient: string; message_id?: string; error?: string }> {
  const payload: Record<string, unknown> = {
    From: `${fromName} <${fromEmail}>`,
    To: to,
    Subject: subject,
    TextBody: body,
    HtmlBody: bodyToHtml(body),
    MessageStream: POSTMARK_MESSAGE_STREAM,
  }
  if (replyTo) payload.ReplyTo = replyTo

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": POSTMARK_API_KEY!,
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json() as PostmarkResponse
  if (!res.ok || data.ErrorCode) {
    return { recipient: to, error: `${res.status} ${data.ErrorCode ?? ""}: ${data.Message ?? "Unknown"}` }
  }
  return { recipient: to, message_id: data.MessageID }
}

async function postmarkSendBatch(
  recipients: string[], fromEmail: string, fromName: string, replyTo: string | undefined,
  subject: string, body: string,
): Promise<Array<{ recipient: string; message_id?: string; error?: string }>> {
  const messages = recipients.map(to => {
    const m: Record<string, unknown> = {
      From: `${fromName} <${fromEmail}>`,
      To: to,
      Subject: subject,
      TextBody: body,
      HtmlBody: bodyToHtml(body),
      MessageStream: POSTMARK_MESSAGE_STREAM,
    }
    if (replyTo) m.ReplyTo = replyTo
    return m
  })

  const res = await fetch("https://api.postmarkapp.com/email/batch", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": POSTMARK_API_KEY!,
    },
    body: JSON.stringify(messages),
  })
  if (!res.ok) {
    const errText = await res.text()
    return recipients.map(r => ({ recipient: r, error: `Batch HTTP ${res.status}: ${errText.slice(0, 200)}` }))
  }
  const data = await res.json() as PostmarkResponse[]
  return data.map((d, i) => ({
    recipient: recipients[i],
    message_id: d.ErrorCode ? undefined : d.MessageID,
    error: d.ErrorCode ? `${d.ErrorCode}: ${d.Message}` : undefined,
  }))
}

// ──────────────────────────────────────────────────────────────────────────────
// Parsing + formatting
// ──────────────────────────────────────────────────────────────────────────────

function parseEmailCopy(copy: string, fallbackTitle?: string): { subject: string; body: string } {
  const trimmed = (copy ?? "").trim()
  // Writer agent shape: "Subject: <line>\n\n<body>"
  const m = trimmed.match(/^Subject:\s*(.+?)\n\s*\n([\s\S]+)$/i)
  if (m) {
    return { subject: m[1].trim(), body: m[2].trim() }
  }
  // Fallback: post.title as subject, full copy as body
  if (fallbackTitle) {
    return { subject: fallbackTitle.trim(), body: trimmed }
  }
  // Last resort: first line as subject
  const lines = trimmed.split(/\n+/)
  if (lines.length > 1) {
    return { subject: lines[0].trim().slice(0, 120), body: lines.slice(1).join("\n").trim() }
  }
  return { subject: "", body: trimmed }
}

// Minimal markdown → HTML for the HtmlBody field. Postmark accepts both and
// recipient clients fall back to TextBody if the HTML is missing, but giving
// it both gives better-looking inboxes.
function bodyToHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1">$1</a>',
  )
  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n")
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;max-width:600px;margin:0 auto;padding:20px;">${paragraphs}</body></html>`
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
