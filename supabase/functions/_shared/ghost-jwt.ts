// Ghost Admin API authentication.
//
// Ghost uses short-lived JWTs (5 min) signed with HMAC-SHA256. The API key
// from the Ghost admin UI is "<24-char id>:<64-char hex secret>". The id
// goes in the `kid` header; the secret is the HMAC key.

export async function makeGhostJwt(apiKey: string): Promise<string> {
  const parts = apiKey.trim().split(':')
  if (parts.length !== 2 || parts[0].length !== 24 || !/^[0-9a-f]{64}$/i.test(parts[1])) {
    throw new Error('Invalid Ghost API key format. Expected "<24-char id>:<64-hex secret>". Copy from Ghost Admin > Integrations.')
  }
  const [id, secretHex] = parts

  const header = { alg: 'HS256', typ: 'JWT', kid: id }
  const now = Math.floor(Date.now() / 1000)
  const payload = { iat: now, exp: now + 5 * 60, aud: '/admin/' }

  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const signingInput = `${b64url(header)}.${b64url(payload)}`

  const secretBytes = new Uint8Array(secretHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))

  const sigEnc = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return `${signingInput}.${sigEnc}`
}
