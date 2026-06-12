import type { AdminClient } from "./auth.ts"

const CLIENT_KEY_ENC = Deno.env.get("CLIENT_API_KEY_ENCRYPTION_KEY") ?? Deno.env.get("VAULT_ENC_KEY") ?? ""

export async function decryptClientSecret(payload: string): Promise<string | null> {
  try {
    if (!CLIENT_KEY_ENC || !payload) return null
    const parts = payload.split(":")
    if (parts.length !== 4 || parts[0] !== "aes-gcm") return null
    const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(CLIENT_KEY_ENC))
    const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"])
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(parts[2]) }, key, b64(parts[3]))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

export async function isMasterOrg(supabase: AdminClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("organizations")
    .select("is_master")
    .eq("id", orgId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { is_master?: boolean } | null)?.is_master === true
}

export async function loadClientApiKey(
  supabase: AdminClient,
  projectId: string,
  providers: string[],
): Promise<{ key: string; provider: string } | null> {
  const { data, error } = await supabase
    .from("client_api_keys")
    .select("id, provider, secret_ciphertext")
    .eq("project_id", projectId)
    .in("provider", providers)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)

  const row = data as { id?: string; provider?: string; secret_ciphertext?: string | null } | null
  if (!row?.secret_ciphertext || !row.provider) return null
  const key = await decryptClientSecret(row.secret_ciphertext)
  if (!key) throw new Error(`Could not decrypt ${row.provider} key for this client space.`)

  if (row.id) {
    await supabase
      .from("client_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", row.id)
  }

  return { key, provider: row.provider }
}
