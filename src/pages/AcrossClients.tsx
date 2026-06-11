import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  FolderOpen,
  KeyRound,
  MailPlus,
  ShieldCheck,
  Star,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Project } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useOrg } from '../lib/orgContext'
import { useProject } from '../lib/projectContext'
import {
  PageHeader,
  SectionLabel,
  EmptyState,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  color,
  space,
  type as t,
  radius,
  useToast,
} from '../design'

type ProjectRole = 'owner' | 'editor' | 'reviewer' | 'viewer'
type AccessState = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

type UserProfile = {
  id: string
  email: string
  full_name: string | null
}

type ProjectMemberRow = {
  id: string
  user_id: string
  role: ProjectRole
  created_at: string
}

type ProjectMember = ProjectMemberRow & {
  user: UserProfile | null
}

type ProjectInvite = {
  id: string
  email: string
  role: ProjectRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at: string | null
  sent_at: string | null
  send_error: string | null
  created_at: string
}

type ProviderModel = {
  id: string
  display_name?: string
  capabilities?: Record<string, boolean>
  context_window?: number | null
}

type ClientApiKey = {
  id: string
  provider: string
  label: string
  config: Record<string, unknown> | null
  models: ProviderModel[] | null
  capabilities: Record<string, boolean> | null
  secret_preview: string | null
  status: 'active' | 'invalid' | 'revoked'
  last_used_at: string | null
  last_tested_at: string | null
  test_error: string | null
  created_at: string
  updated_at: string
}

const roleOptions: Array<{ value: ProjectRole; label: string; help: string }> = [
  { value: 'owner', label: 'Owner', help: 'Manage people, keys, and client settings' },
  { value: 'editor', label: 'Editor', help: 'Create and edit client work' },
  { value: 'reviewer', label: 'Reviewer', help: 'Review and approve content' },
  { value: 'viewer', label: 'Viewer', help: 'Read only access' },
]

const providerOptions = [
  // Only Anthropic (text) BYOK is wired today — generation runs on the client's
  // own Anthropic key. Image-capable providers (OpenAI/Gemini) are intentionally
  // not offered yet, since image generation still runs on the platform keys.
  { value: 'anthropic', label: 'Anthropic' },
]

const panelStyle: CSSProperties = {
  border: `1px solid ${color.line}`,
  borderRadius: radius.md,
  background: color.surface,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: space[3],
  padding: `${space[4]} ${space[5]}`,
  borderTop: `1px solid ${color.line}`,
}

export default function AcrossClients() {
  const navigate = useNavigate()
  const { session, user } = useAuth()
  const { activeOrg } = useOrg()
  const { projects, switchProject, loading, refetch } = useProject()
  const { push } = useToast()

  const [obsByProject, setObsByProject] = useState<Record<string, number>>({})
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [accessState, setAccessState] = useState<AccessState>('idle')
  const [accessError, setAccessError] = useState<string | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [invites, setInvites] = useState<ProjectInvite[]>([])
  const [apiKeys, setApiKeys] = useState<ClientApiKey[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectRole>('editor')
  const [keyProvider, setKeyProvider] = useState('anthropic')
  const [keyLabel, setKeyLabel] = useState('Primary key')
  const [keySecret, setKeySecret] = useState('')
  const [keyConfig, setKeyConfig] = useState('')

  useEffect(() => {
    if (!activeOrg?.id) {
      return
    }
    let cancelled = false
    supabase
      .from('agent_observations')
      .select('project_id')
      .eq('org_id', activeOrg.id)
      .eq('status', 'open')
      .neq('kind', 'stale_audit')
      .then(({ data }) => {
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const row of (data ?? []) as Array<{ project_id: string | null }>) {
          if (row.project_id) counts[row.project_id] = (counts[row.project_id] ?? 0) + 1
        }
        setObsByProject(counts)
      })
    return () => { cancelled = true }
  }, [activeOrg?.id])

  const orderedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const starred = Number(b.is_starred) - Number(a.is_starred)
      if (starred !== 0) return starred
      const open = (obsByProject[b.id] ?? 0) - (obsByProject[a.id] ?? 0)
      if (open !== 0) return open
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
  }, [projects, obsByProject])

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? orderedProjects[0] ?? null,
    [orderedProjects, projects, selectedProjectId],
  )

  const loadAccess = useCallback(async () => {
    if (!selectedProject?.id) {
      setMembers([])
      setInvites([])
      setApiKeys([])
      setAccessState('idle')
      return
    }

    setAccessState('loading')
    setAccessError(null)

    const [membersResult, invitesResult, keysResult] = await Promise.all([
      supabase
        .from('project_members')
        .select('id, user_id, role, created_at')
        .eq('project_id', selectedProject.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('project_invites')
        .select('id, email, role, status, expires_at, sent_at, send_error, created_at')
        .eq('project_id', selectedProject.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('client_api_keys')
        .select('id, provider, label, config, models, capabilities, secret_preview, status, last_used_at, last_tested_at, test_error, created_at, updated_at')
        .eq('project_id', selectedProject.id)
        .order('updated_at', { ascending: false }),
    ])

    const firstError = membersResult.error ?? invitesResult.error ?? keysResult.error
    if (firstError) {
      setMembers([])
      setInvites([])
      setApiKeys([])
      setAccessError(firstError.message)
      setAccessState(isMissingAccessError(firstError.message) ? 'missing' : 'error')
      return
    }

    const memberRows = ((membersResult.data ?? []) as ProjectMemberRow[])
    const userIds = Array.from(new Set(memberRows.map(row => row.user_id).filter(Boolean)))
    const usersById = new Map<string, UserProfile>()
    if (userIds.length > 0) {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, email, full_name')
        .in('id', userIds)
      for (const profile of (usersData ?? []) as UserProfile[]) usersById.set(profile.id, profile)
    }

    setMembers(memberRows.map(row => ({ ...row, user: usersById.get(row.user_id) ?? null })))
    setInvites((invitesResult.data ?? []) as ProjectInvite[])
    setApiKeys((keysResult.data ?? []) as ClientApiKey[])
    setAccessState('ready')
  }, [selectedProject])

  useEffect(() => {
    void loadAccess()
  }, [loadAccess])

  const selectedOpenCount = selectedProject ? obsByProject[selectedProject.id] ?? 0 : 0
  const pendingInvites = invites.filter(invite => invite.status === 'pending')
  const activeKeys = apiKeys.filter(key => key.status === 'active')

  async function sendInvite() {
    if (!selectedProject || !session?.access_token) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      push({ kind: 'warn', title: 'Add a valid email address' })
      return
    }

    setBusyAction('invite')
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'create', project_id: selectedProject.id, email, role: inviteRole }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `Invite failed with HTTP ${res.status}`)
      setInviteEmail('')
      await loadAccess()
      push({ kind: 'success', title: 'Invite sent via Postmark', body: `${email} was invited as ${roleLabel(inviteRole)}.` })
    } catch (error) {
      push({ kind: 'danger', title: 'Invite failed', body: error instanceof Error ? error.message : 'Invite could not be sent' })
    } finally {
      setBusyAction(null)
    }
  }

  async function updateMemberRole(memberId: string, role: ProjectRole) {
    setBusyAction(`member:${memberId}`)
    const { error } = await supabase.from('project_members').update({ role }).eq('id', memberId)
    setBusyAction(null)
    if (error) {
      push({ kind: 'danger', title: 'Role update failed', body: error.message })
      return
    }
    setMembers(prev => prev.map(member => member.id === memberId ? { ...member, role } : member))
  }

  async function removeMember(memberId: string) {
    setBusyAction(`remove:${memberId}`)
    const { error } = await supabase.from('project_members').delete().eq('id', memberId)
    setBusyAction(null)
    if (error) {
      push({ kind: 'danger', title: 'Remove failed', body: error.message })
      return
    }
    setMembers(prev => prev.filter(member => member.id !== memberId))
  }

  async function revokeInvite(inviteId: string) {
    setBusyAction(`invite:${inviteId}`)
    const { error } = await supabase.from('project_invites').update({ status: 'revoked' }).eq('id', inviteId)
    setBusyAction(null)
    if (error) {
      push({ kind: 'danger', title: 'Invite revoke failed', body: error.message })
      return
    }
    setInvites(prev => prev.map(invite => invite.id === inviteId ? { ...invite, status: 'revoked' } : invite))
  }

  async function saveApiKey() {
    if (!selectedProject || !session?.access_token) return
    if (!keyLabel.trim() || !keySecret.trim()) {
      push({ kind: 'warn', title: 'Add a label and API key' })
      return
    }

    let config: Record<string, unknown>
    try {
      config = parseConfig(keyConfig)
    } catch (error) {
      push({ kind: 'danger', title: 'Provider config is invalid', body: error instanceof Error ? error.message : 'Use a JSON object' })
      return
    }

    setBusyAction('api-key')
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-secrets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          project_id: selectedProject.id,
          provider: keyProvider,
          label: keyLabel.trim(),
          secret: keySecret.trim(),
          config,
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; model_count?: number; warning?: string }
      if (!res.ok) throw new Error(data.error ?? `API key save failed with HTTP ${res.status}`)
      setKeySecret('')
      await loadAccess()
      push({
        kind: data.warning ? 'warn' : 'success',
        title: data.warning ? 'Key saved with a note' : 'API key saved',
        body: data.warning ?? `${data.model_count ?? 0} models synced for ${providerLabel(keyProvider)}.`,
      })
    } catch (error) {
      push({ kind: 'danger', title: 'API key save failed', body: error instanceof Error ? error.message : 'Key could not be saved' })
    } finally {
      setBusyAction(null)
    }
  }

  async function revokeApiKey(keyId: string) {
    setBusyAction(`key:${keyId}`)
    const { error } = await supabase.from('client_api_keys').update({ status: 'revoked' }).eq('id', keyId)
    setBusyAction(null)
    if (error) {
      push({ kind: 'danger', title: 'Key revoke failed', body: error.message })
      return
    }
    setApiKeys(prev => prev.map(key => key.id === keyId ? { ...key, status: 'revoked' } : key))
  }

  async function removeClientSpace(project: Project) {
    const ok = window.confirm(`Remove ${project.name} from active client spaces? Its history stays archived.`)
    if (!ok) return
    setBusyAction('archive-client')
    const { error } = await supabase.from('projects').update({ is_archived: true }).eq('id', project.id)
    setBusyAction(null)
    if (error) {
      push({ kind: 'danger', title: 'Client remove failed', body: error.message })
      return
    }
    push({ kind: 'success', title: 'Client space removed', body: `${project.name} was archived.` })
    setSelectedProjectId(null)
    refetch()
  }

  function openClient(project: Project) {
    switchProject(project.slug)
    navigate(`/p/${project.slug}/vera`)
  }

  if (!loading && projects.length === 0) {
    return (
      <div style={{ padding: space[8], maxWidth: 940 }}>
        <EmptyState
          icon={<FolderOpen size={22} strokeWidth={1.5} />}
          title="No clients yet"
          body="Each client is a project with its own brain, content, approvals, roles, and keys. Add your first client to begin."
          actions={<Button variant="primary" onClick={() => navigate('/onboarding')}>Add a client</Button>}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: space[8], maxWidth: 1220 }}>
      <PageHeader
        eyebrow={activeOrg?.name ?? 'Workspace'}
        title="Client settings"
        subtitle="Manage client spaces, access, invites, roles, and provider keys from one workspace view."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: space[4], marginBottom: space[7] }}>
        <Metric label="Clients" value={projects.length} />
        <Metric label="Open proposals" value={Object.values(obsByProject).reduce((sum, count) => sum + count, 0)} />
        <Metric label="People" value={accessState === 'ready' ? members.length + pendingInvites.length : 'Setup'} />
        <Metric label="Active keys" value={accessState === 'ready' ? activeKeys.length : 'Setup'} />
      </div>

      <div style={{ display: 'flex', gap: space[7], alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <aside style={{ flex: '1 1 320px', maxWidth: 390, minWidth: 280 }}>
          <SectionLabel count={orderedProjects.length} style={{ marginBottom: space[4] }}>Client spaces</SectionLabel>
          <div style={panelStyle}>
            {orderedProjects.map(project => (
              <ClientRow
                key={project.id}
                project={project}
                selected={project.id === selectedProject?.id}
                openCount={obsByProject[project.id] ?? 0}
                onSelect={() => setSelectedProjectId(project.id)}
              />
            ))}
          </div>
        </aside>

        <main style={{ flex: '2 1 560px', minWidth: 0 }}>
          {!selectedProject ? (
            <EmptyState
              icon={<FolderOpen size={22} strokeWidth={1.5} />}
              title="Select a client"
              body="Choose a client space to manage its access, invites, roles, and provider keys."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: space[5] }}>
              <ClientHeader
                project={selectedProject}
                openCount={selectedOpenCount}
                removing={busyAction === 'archive-client'}
                onOpen={() => openClient(selectedProject)}
                onRemove={() => removeClientSpace(selectedProject)}
              />

              {accessState === 'missing' && (
                <SetupPanel error={accessError} />
              )}

              {accessState === 'error' && (
                <ErrorPanel message={accessError ?? 'Client access could not load'} onRetry={loadAccess} />
              )}

              {accessState === 'loading' && (
                <div style={{ ...panelStyle, padding: space[6], color: color.ink2, fontSize: t.size.sm }}>Loading client settings...</div>
              )}

              {accessState === 'ready' && (
                <>
                  <section style={panelStyle}>
                    <PanelTitle
                      icon={<Users size={16} />}
                      title="People and invitations"
                      subtitle="Invite clients by email, assign roles, and manage project-level access."
                    />
                    <div style={{ padding: space[5], borderTop: `1px solid ${color.line}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 150px auto', gap: space[3], alignItems: 'end' }}>
                        <Field label="Client email">
                          <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="client@company.com" />
                        </Field>
                        <Field label="Role">
                          <Select value={inviteRole} onChange={e => setInviteRole(e.target.value as ProjectRole)}>
                            {roleOptions.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                          </Select>
                        </Field>
                        <Button
                          variant="primary"
                          leading={<MailPlus size={14} />}
                          loading={busyAction === 'invite'}
                          disabled={!inviteEmail.trim()}
                          onClick={sendInvite}
                        >
                          Send invite
                        </Button>
                      </div>
                      <p style={{ margin: `${space[3]} 0 0`, color: color.faint, fontSize: t.size.cap }}>
                        Invites are sent through Postmark from the InnovareAI space.
                      </p>
                    </div>

                    <div>
                      {members.length === 0 && pendingInvites.length === 0 ? (
                        <p style={{ margin: 0, padding: space[5], borderTop: `1px solid ${color.line}`, color: color.ghost, fontSize: t.size.sm }}>
                          No client-specific people yet.
                        </p>
                      ) : (
                        <>
                          {members.map(member => (
                            <MemberRow
                              key={member.id}
                              member={member}
                              disabled={member.user_id === user?.id}
                              busy={busyAction === `member:${member.id}` || busyAction === `remove:${member.id}`}
                              onRoleChange={role => updateMemberRole(member.id, role)}
                              onRemove={() => removeMember(member.id)}
                            />
                          ))}
                          {invites.map(invite => (
                            <InviteRow
                              key={invite.id}
                              invite={invite}
                              busy={busyAction === `invite:${invite.id}`}
                              onRevoke={() => revokeInvite(invite.id)}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  </section>

                  <section style={panelStyle}>
                    <PanelTitle
                      icon={<KeyRound size={16} />}
                      title="Provider keys"
                      subtitle="Store one encrypted key per provider and label. Vera syncs model metadata when the provider allows it."
                    />
                    <div style={{ padding: space[5], borderTop: `1px solid ${color.line}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(180px, 1fr)', gap: space[3], marginBottom: space[3] }}>
                        <Field label="Provider">
                          <Select value={keyProvider} onChange={e => setKeyProvider(e.target.value)}>
                            {providerOptions.map(provider => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
                          </Select>
                        </Field>
                        <Field label="Label">
                          <Input value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="Primary key" />
                        </Field>
                      </div>
                      <Field label="API key">
                        <Input
                          type="password"
                          value={keySecret}
                          onChange={e => setKeySecret(e.target.value)}
                          placeholder="Paste the provider API key"
                          autoComplete="off"
                        />
                      </Field>
                      <div style={{ height: space[3] }} />
                      <Field label="Provider config JSON" optional helper="Use this for Azure endpoints or provider-specific options. Do not put secondary secrets here.">
                        <Textarea
                          rows={3}
                          value={keyConfig}
                          onChange={e => setKeyConfig(e.target.value)}
                          placeholder='{"endpoint":"https://example.openai.azure.com","api_version":"2024-10-21"}'
                        />
                      </Field>
                      <div style={{ marginTop: space[4], display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                          variant="primary"
                          leading={<KeyRound size={14} />}
                          loading={busyAction === 'api-key'}
                          disabled={!keySecret.trim() || !keyLabel.trim()}
                          onClick={saveApiKey}
                        >
                          Save key
                        </Button>
                      </div>
                    </div>

                    <div>
                      {apiKeys.length === 0 ? (
                        <p style={{ margin: 0, padding: space[5], borderTop: `1px solid ${color.line}`, color: color.ghost, fontSize: t.size.sm }}>
                          No provider keys saved for this client.
                        </p>
                      ) : apiKeys.map(apiKey => (
                        <ApiKeyRow
                          key={apiKey.id}
                          apiKey={apiKey}
                          busy={busyAction === `key:${apiKey.id}`}
                          onRevoke={() => revokeApiKey(apiKey.id)}
                        />
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function ClientRow({ project, selected, openCount, onSelect }: { project: Project; selected: boolean; openCount: number; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: space[3],
        padding: `${space[4]} ${space[4]}`,
        border: 0,
        borderTop: `1px solid ${color.line}`,
        background: selected ? color.paper2 : color.surface,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: t.family.sans,
      }}
    >
      <span style={{
        width: 26,
        height: 26,
        borderRadius: radius.xs,
        flexShrink: 0,
        background: project.is_starred ? color.ink : color.paper2,
        color: project.is_starred ? color.surface : color.ink2,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: t.size.cap,
        fontWeight: t.weight.semibold,
      }}>
        {project.is_starred ? <Star size={12} fill="currentColor" /> : project.name.slice(0, 1).toUpperCase()}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: t.size.sm, fontWeight: t.weight.medium, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {project.name}
        </span>
        <span style={{ display: 'block', fontSize: t.size.cap, color: color.ghost, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {project.description || 'No description'}
        </span>
      </span>
      {openCount > 0 && <StatusPill tone="accent">{openCount} open</StatusPill>}
      {selected && <Check size={14} color={color.accent} />}
    </button>
  )
}

function ClientHeader({
  project,
  openCount,
  removing,
  onOpen,
  onRemove,
}: {
  project: Project
  openCount: number
  removing: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <section style={{ ...panelStyle, padding: space[5] }}>
      <div style={{ display: 'flex', gap: space[4], alignItems: 'flex-start' }}>
        <span style={{
          width: 38,
          height: 38,
          borderRadius: radius.md,
          background: color.accent,
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: t.size.body,
          fontWeight: t.weight.semibold,
          flexShrink: 0,
        }}>
          {project.name.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, color: color.ink, fontSize: t.size.h3, lineHeight: t.lineHeight.snug, fontWeight: t.weight.semibold }}>{project.name}</h2>
            {openCount > 0 && <StatusPill tone="accent">{openCount} proposal{openCount === 1 ? '' : 's'}</StatusPill>}
          </div>
          <p style={{ margin: `${space[1]} 0 0`, color: color.ink2, fontSize: t.size.sm, lineHeight: t.lineHeight.relaxed }}>
            {project.description || 'Client space settings, access, and provider configuration.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="secondary" leading={<ArrowRight size={14} />} onClick={onOpen}>Open</Button>
          <Button variant="danger" leading={<Trash2 size={14} />} loading={removing} onClick={onRemove}>Remove</Button>
        </div>
      </div>
    </section>
  )
}

function MemberRow({
  member,
  disabled,
  busy,
  onRoleChange,
  onRemove,
}: {
  member: ProjectMember
  disabled: boolean
  busy: boolean
  onRoleChange: (role: ProjectRole) => void
  onRemove: () => void
}) {
  const name = member.user?.full_name || member.user?.email || member.user_id
  return (
    <div style={rowStyle}>
      <Avatar label={name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: t.size.sm, fontWeight: t.weight.medium, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: t.size.cap, color: color.ghost, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.user?.email ?? 'User profile pending'}</div>
      </div>
      <Select
        value={member.role}
        disabled={disabled || busy}
        onChange={event => onRoleChange(event.target.value as ProjectRole)}
        style={{ width: 134 }}
      >
        {roleOptions.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
      </Select>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        leading={<Trash2 size={14} />}
        disabled={disabled || busy}
        onClick={onRemove}
        aria-label="Remove member"
      />
    </div>
  )
}

function InviteRow({ invite, busy, onRevoke }: { invite: ProjectInvite; busy: boolean; onRevoke: () => void }) {
  return (
    <div style={rowStyle}>
      <Avatar label={invite.email} pending />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
          <span style={{ fontSize: t.size.sm, fontWeight: t.weight.medium, color: color.ink }}>{invite.email}</span>
          <StatusPill tone={invite.status === 'pending' ? 'warn' : invite.status === 'accepted' ? 'success' : 'muted'}>{invite.status}</StatusPill>
        </div>
        <div style={{ fontSize: t.size.cap, color: invite.send_error ? color.danger : color.ghost }}>
          {invite.send_error ? invite.send_error : `Invited as ${roleLabel(invite.role)}${invite.sent_at ? ` on ${formatDate(invite.sent_at)}` : ''}`}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        leading={<XCircle size={14} />}
        disabled={invite.status !== 'pending' || busy}
        onClick={onRevoke}
      >
        Revoke
      </Button>
    </div>
  )
}

function ApiKeyRow({ apiKey, busy, onRevoke }: { apiKey: ClientApiKey; busy: boolean; onRevoke: () => void }) {
  const capabilities = Object.entries(apiKey.capabilities ?? {}).filter(([, enabled]) => enabled).map(([key]) => key)
  const models = Array.isArray(apiKey.models) ? apiKey.models : []
  return (
    <div style={rowStyle}>
      <span style={{
        width: 30,
        height: 30,
        borderRadius: radius.sm,
        background: color.paper2,
        color: color.accent,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <KeyRound size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
          <span style={{ fontSize: t.size.sm, fontWeight: t.weight.medium, color: color.ink }}>{apiKey.label}</span>
          <StatusPill tone={apiKey.status === 'active' ? 'success' : apiKey.status === 'invalid' ? 'danger' : 'muted'}>{apiKey.status}</StatusPill>
          <span style={{ fontSize: t.size.cap, color: color.ghost }}>{providerLabel(apiKey.provider)}</span>
          {apiKey.secret_preview && <span style={{ fontSize: t.size.cap, color: color.faint }}>{apiKey.secret_preview}</span>}
        </div>
        <div style={{ marginTop: 3, fontSize: t.size.cap, color: apiKey.test_error ? color.warn : color.ghost }}>
          {apiKey.test_error || `${models.length} model${models.length === 1 ? '' : 's'} synced${apiKey.last_tested_at ? ` on ${formatDate(apiKey.last_tested_at)}` : ''}`}
        </div>
        {capabilities.length > 0 && (
          <div style={{ display: 'flex', gap: space[1], flexWrap: 'wrap', marginTop: space[2] }}>
            {capabilities.slice(0, 7).map(capability => (
              <StatusPill key={capability} tone="muted">{formatCapability(capability)}</StatusPill>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        leading={<XCircle size={14} />}
        disabled={apiKey.status === 'revoked' || busy}
        onClick={onRevoke}
      >
        Revoke
      </Button>
    </div>
  )
}

function PanelTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ padding: space[5], display: 'flex', gap: space[3], alignItems: 'flex-start' }}>
      <span style={{ color: color.accent, marginTop: 1 }}>{icon}</span>
      <div>
        <h3 style={{ margin: 0, color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>{title}</h3>
        <p style={{ margin: `${space[1]} 0 0`, color: color.ink2, fontSize: t.size.sm, lineHeight: t.lineHeight.relaxed }}>{subtitle}</p>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ ...panelStyle, padding: space[4] }}>
      <div style={{ fontSize: t.size.cap, color: color.ghost, fontWeight: t.weight.medium }}>{label}</div>
      <div style={{ marginTop: space[1], fontSize: t.size.h3, lineHeight: t.lineHeight.snug, color: color.ink, fontWeight: t.weight.semibold }}>{value}</div>
    </div>
  )
}

function SetupPanel({ error }: { error: string | null }) {
  return (
    <section style={{ ...panelStyle, padding: space[6] }}>
      <div style={{ display: 'flex', gap: space[3], alignItems: 'flex-start' }}>
        <ShieldCheck size={18} color={color.accent} />
        <div>
          <h3 style={{ margin: 0, color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>Client access schema needed</h3>
          <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.sm, lineHeight: t.lineHeight.relaxed }}>
            Apply the client access migration to enable client invitations, roles, and API key management.
          </p>
          {error && <p style={{ margin: `${space[3]} 0 0`, color: color.faint, fontSize: t.size.cap }}>{error}</p>}
        </div>
      </div>
    </section>
  )
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section style={{ ...panelStyle, padding: space[6] }}>
      <h3 style={{ margin: 0, color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>Client settings could not load</h3>
      <p style={{ margin: `${space[2]} 0 ${space[4]}`, color: color.danger, fontSize: t.size.sm }}>{message}</p>
      <Button variant="secondary" onClick={onRetry}>Try again</Button>
    </section>
  )
}

function Avatar({ label, pending = false }: { label: string; pending?: boolean }) {
  return (
    <span style={{
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      background: pending ? color.paper2 : color.ink,
      color: pending ? color.ink2 : color.surface,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: t.size.cap,
      fontWeight: t.weight.semibold,
      flexShrink: 0,
    }}>
      {label.slice(0, 2).toUpperCase()}
    </span>
  )
}

function StatusPill({ tone, children }: { tone: 'accent' | 'success' | 'warn' | 'danger' | 'muted'; children: React.ReactNode }) {
  const styles: Record<typeof tone, CSSProperties> = {
    accent: { color: color.accent, background: color.accentSoft },
    success: { color: color.success, background: 'rgba(16,185,129,0.10)' },
    warn: { color: color.warn, background: 'rgba(245,158,11,0.12)' },
    danger: { color: color.danger, background: 'rgba(185,28,28,0.10)' },
    muted: { color: color.ghost, background: color.paper2 },
  }
  return (
    <span style={{
      ...styles[tone],
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: radius.xs,
      padding: '2px 6px',
      fontSize: t.size.cap,
      fontWeight: t.weight.medium,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function isMissingAccessError(message: string) {
  return /project_members|project_invites|client_api_keys|schema cache|does not exist/i.test(message)
}

function parseConfig(raw: string) {
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Provider config must be a JSON object.')
  return parsed as Record<string, unknown>
}

function roleLabel(role: ProjectRole) {
  return roleOptions.find(option => option.value === role)?.label ?? role
}

function providerLabel(provider: string) {
  return providerOptions.find(option => option.value === provider)?.label ?? provider
}

function formatCapability(capability: string) {
  return capability.replace(/_/g, ' ')
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
}
