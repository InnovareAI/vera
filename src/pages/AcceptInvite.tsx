import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Loader2, XCircle } from 'lucide-react'
import { Button, color, radius, shadow, space, type as t } from '../design'
import { useAuth } from '../lib/auth'

type AcceptState =
  | { status: 'loading'; message: string }
  | { status: 'success'; message: string; projectSlug: string | null }
  | { status: 'error'; message: string }

export default function AcceptInvite() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const accessToken = session?.access_token
  const [state, setState] = useState<AcceptState>({ status: 'loading', message: 'Accepting invite...' })

  useEffect(() => {
    if (!accessToken || !token) return
    let cancelled = false

    async function accept() {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-invites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ action: 'accept', token }),
        })
        const data = await res.json().catch(() => ({})) as { error?: string; project_slug?: string | null; project_name?: string | null }
        if (!res.ok) throw new Error(data.error ?? `Invite accept failed with HTTP ${res.status}`)
        if (cancelled) return
        const projectSlug = data.project_slug ?? null
        setState({
          status: 'success',
          message: data.project_name ? `You now have access to ${data.project_name}.` : 'You now have access to this space.',
          projectSlug,
        })
        window.setTimeout(() => {
          if (projectSlug) window.location.assign(`/p/${projectSlug}/vera`)
          else window.location.assign('/spaces')
        }, 900)
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Invite accept failed' })
      }
    }

    void accept()
    return () => { cancelled = true }
  }, [accessToken, token])

  const isLoading = state.status === 'loading'
  const isSuccess = state.status === 'success'

  return (
    <div style={{ minHeight: '100vh', background: color.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[6] }}>
      <div style={{
        width: 'min(440px, 100%)',
        background: color.surface,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        boxShadow: shadow.pop,
        padding: space[8],
        textAlign: 'center',
      }}>
        <span style={{
          width: 48,
          height: 48,
          borderRadius: radius.md,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isSuccess ? 'rgba(16,185,129,0.12)' : state.status === 'error' ? 'rgba(185,28,28,0.10)' : color.paper2,
          color: isSuccess ? color.success : state.status === 'error' ? color.danger : color.accent,
        }}>
          {isLoading ? <Loader2 size={23} className="animate-spin" /> : isSuccess ? <Check size={23} /> : <XCircle size={23} />}
        </span>
        <h1 style={{ margin: `${space[5]} 0 ${space[2]}`, color: color.ink, fontSize: t.size.h2, fontWeight: t.weight.semibold }}>
          {isLoading ? 'Joining space' : isSuccess ? 'Invite accepted' : 'Invite could not be accepted'}
        </h1>
        <p style={{ margin: 0, color: color.ink2, fontSize: t.size.sm, lineHeight: t.lineHeight.relaxed }}>
          {state.message}
        </p>
        {state.status === 'error' && (
          <div style={{ marginTop: space[6], display: 'flex', justifyContent: 'center' }}>
            <Button variant="secondary" onClick={() => navigate('/spaces')}>Back to spaces</Button>
          </div>
        )}
      </div>
    </div>
  )
}
