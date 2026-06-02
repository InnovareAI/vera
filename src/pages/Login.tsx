// VERA login — mirrors SAM's handler: Google + Microsoft SSO (Supabase
// signInWithOAuth) + a magic-link email fallback (SMTP). Built to match SAM
// so the upcoming unified "InnovareAI Agentic System" login is a config merge,
// not a rewrite — same providers, same flow.

import { useState } from 'react'
import { Mail, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Brand glyphs (inline so we don't pull an icon dep for two logos).
function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState<null | 'google' | 'azure' | 'email'>(null)
  const [error, setError] = useState('')

  async function oauth(provider: 'google' | 'azure') {
    setError(''); setLoading(provider)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
        scopes: provider === 'azure' ? 'email profile offline_access' : 'email profile',
      },
    })
    // On success the browser redirects to the provider; on error, surface it.
    if (error) { setError(error.message); setLoading(null) }
  }

  async function emailLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setError(''); setLoading('email')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) { setError(error.message); setLoading(null) }
    else { setSent(true); setLoading(null) }
  }

  const ssoBtn: React.CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 44, borderRadius: 'var(--radius-md)', border: '1px solid var(--line-2)',
    background: 'var(--surface)', color: 'var(--ink)', fontSize: 14, fontWeight: 500,
    fontFamily: 'var(--font-body)', cursor: 'pointer',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--paper)' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 28 }}>
          <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>V</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>VERA</span>
        </div>

        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-pop)', padding: 28 }}>
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <span style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-tint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <Check size={22} style={{ color: 'var(--accent)' }} />
              </span>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: '0 0 6px' }}>Check your inbox</h2>
              <p style={{ fontSize: 13.5, color: 'var(--ghost)', lineHeight: 1.5, margin: 0 }}>
                Magic link sent to <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{email}</span>. Click it to sign in.
              </p>
              <button onClick={() => { setSent(false); setEmail('') }} style={{ marginTop: 18, fontSize: 12, color: 'var(--ghost)', background: 'none', border: 'none', cursor: 'pointer' }}>Use a different email</button>
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>Sign in to VERA</h2>
              <p style={{ fontSize: 13.5, color: 'var(--ghost)', margin: '0 0 22px' }}>InnovareAI Agentic System</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button onClick={() => oauth('google')} disabled={!!loading} style={{ ...ssoBtn, opacity: loading && loading !== 'google' ? 0.5 : 1 }}>
                  {loading === 'google' ? <Loader2 size={16} className="animate-spin" /> : <GoogleG />} Continue with Google
                </button>
                <button onClick={() => oauth('azure')} disabled={!!loading} style={{ ...ssoBtn, opacity: loading && loading !== 'azure' ? 0.5 : 1 }}>
                  {loading === 'azure' ? <Loader2 size={16} className="animate-spin" /> : <MicrosoftLogo />} Continue with Microsoft
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
                <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span style={{ fontSize: 11.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>or</span>
                <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>

              <form onSubmit={emailLink} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ position: 'relative' }}>
                  <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }} />
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com" required
                    style={{ width: '100%', height: 44, paddingLeft: 36, paddingRight: 14, fontSize: 14, fontFamily: 'var(--font-body)', color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius-md)', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <button type="submit" disabled={!!loading} style={{ height: 44, borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow-glow)' }}>
                  {loading === 'email' ? <Loader2 size={16} className="animate-spin" /> : <Mail size={15} />} Email me a magic link
                </button>
              </form>
            </>
          )}

          {error && <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--danger)', textAlign: 'center' }}>{error}</p>}
        </div>

        <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--faint)', marginTop: 18 }}>
          One sign-in across InnovareAI — SAM &amp; VERA.
        </p>
      </div>
    </div>
  )
}
