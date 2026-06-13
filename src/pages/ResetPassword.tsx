import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, LockKeyhole } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { session, loading: authLoading } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!session) {
      setError('Open the recovery link from your email again.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setSaved(true)
    setTimeout(() => navigate('/', { replace: true }), 900)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 44,
    paddingLeft: 36,
    paddingRight: 14,
    fontSize: 14,
    fontFamily: 'var(--font-body)',
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: '1px solid var(--line-2)',
    borderRadius: 'var(--radius-md)',
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--paper)' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 28 }}>
          <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>V</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>VERA</span>
        </div>

        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-pop)', padding: 28 }}>
          {saved ? (
            <div style={{ textAlign: 'center' }}>
              <span style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-tint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <Check size={22} style={{ color: 'var(--accent)' }} />
              </span>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: '0 0 6px' }}>Password updated</h2>
              <p style={{ fontSize: 13.5, color: 'var(--ghost)', lineHeight: 1.5, margin: 0 }}>
                Taking you back into VERA.
              </p>
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>Set a new password</h2>
              <p style={{ fontSize: 13.5, color: 'var(--ghost)', margin: '0 0 22px', lineHeight: 1.5 }}>
                Choose a password for your VERA account.
              </p>

              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ position: 'relative' }}>
                  <LockKeyhole size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }} />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="New password"
                    required
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                </div>
                <div style={{ position: 'relative' }}>
                  <LockKeyhole size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }} />
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Confirm password"
                    required
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                </div>
                {!authLoading && !session && (
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ghost)', lineHeight: 1.5 }}>
                    This page needs the recovery link from your email.
                  </p>
                )}
                <button
                  type="submit"
                  disabled={saving || authLoading}
                  style={{ height: 44, borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: saving || authLoading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow-glow)', opacity: saving || authLoading ? 0.7 : 1 }}
                >
                  {saving || authLoading ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={15} />}
                  Save password
                </button>
              </form>
            </>
          )}

          {error && <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--danger)', textAlign: 'center' }}>{error}</p>}
        </div>

        <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--faint)', marginTop: 18 }}>
          One sign-in for VERA and InnovareAI apps.
        </p>
      </div>
    </div>
  )
}
