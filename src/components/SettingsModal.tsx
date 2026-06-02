// Settings as a modal — SAM-style (WorkspaceSettingsModal). Wraps VERA's
// existing tabbed Settings page in a centered overlay so it opens from the
// rail without a full page navigation. /settings still works as a deep link.

import { useEffect } from 'react'
import { X } from 'lucide-react'
import Settings from '../pages/Settings'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(20,20,22,0.42)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(960px, 94vw)', height: 'min(660px, 88vh)', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', position: 'relative', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--line)' }}
      >
        <button
          onClick={onClose} title="Close" aria-label="Close settings"
          style={{ position: 'absolute', top: 14, right: 14, zIndex: 2, width: 30, height: 30, borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--paper-2)', color: 'var(--ink-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={16} />
        </button>
        <Settings />
      </div>
    </div>
  )
}
