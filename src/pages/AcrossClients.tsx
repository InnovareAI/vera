import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CalendarDays,
  Check,
  CheckSquare,
  FolderOpen,
  KeyRound,
  MailPlus,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
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

type SpaceStats = {
  members: number
  pendingInvites: number
  activeKeys: number
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

type ShelfObservation = {
  id: string
  org_id: string
  project_id: string | null
  kind: string
  severity: 'low' | 'medium' | 'high' | string
  title: string
  detail: string | null
  proposed_action: string | null
  action_kind: string | null
  action_payload: Record<string, unknown> | null
  created_at: string
}

const roleOptions: Array<{ value: ProjectRole; label: string; help: string }> = [
  { value: 'owner', label: 'Owner', help: 'Manage people, keys, and space settings' },
  { value: 'editor', label: 'Editor', help: 'Create and edit space work' },
  { value: 'reviewer', label: 'Reviewer', help: 'Review and approve content' },
  { value: 'viewer', label: 'Viewer', help: 'Read only access' },
]

const providerOptions = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'fal', label: 'FAL' },
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
  const [observations, setObservations] = useState<ShelfObservation[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [accessState, setAccessState] = useState<AccessState>('idle')
  const [accessError, setAccessError] = useState<string | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [invites, setInvites] = useState<ProjectInvite[]>([])
  const [apiKeys, setApiKeys] = useState<ClientApiKey[]>([])
  const [spaceStats, setSpaceStats] = useState<Record<string, SpaceStats>>({})
  const [spaceStatsReady, setSpaceStatsReady] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectRole>('editor')
  const [keyProvider, setKeyProvider] = useState('anthropic')
  const [keyLabel, setKeyLabel] = useState('Primary key')
  const [keySecret, setKeySecret] = useState('')
  const [keyConfig, setKeyConfig] = useState('')

  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects])

  const loadObservations = useCallback(async () => {
    if (!activeOrg?.id || projects.length === 0) {
      setObservations([])
      setObsByProject({})
      return
    }

    const knownProjectIds = new Set(projects.map(project => project.id))
    const { data, error } = await supabase
      .from('agent_observations')
      .select('id, org_id, project_id, kind, severity, title, detail, proposed_action, action_kind, action_payload, created_at')
      .eq('org_id', activeOrg.id)
      .eq('status', 'open')
      .neq('kind', 'stale_audit')
      .order('created_at', { ascending: false })
      .limit(32)

    if (error) {
      setObservations([])
      setObsByProject({})
      return
    }

    const rows = ((data ?? []) as ShelfObservation[])
      .filter(obs => Boolean(obs.project_id) && knownProjectIds.has(obs.project_id as string) && obs.action_kind !== 'run_audit')
      .sort((a, b) => {
        const severity = severityRank(a.severity) - severityRank(b.severity)
        if (severity !== 0) return severity
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })

    const counts: Record<string, number> = {}
    for (const obs of rows) {
      if (obs.project_id) counts[obs.project_id] = (counts[obs.project_id] ?? 0) + 1
    }

    setObservations(rows)
    setObsByProject(counts)
  }, [activeOrg?.id, projects])

  useEffect(() => {
    void loadObservations()
  }, [loadObservations])

  const loadSpaceStats = useCallback(async () => {
    const ids = projects.map(project => project.id)
    if (ids.length === 0) {
      setSpaceStats({})
      setSpaceStatsReady(true)
      return
    }

    const base = createSpaceStats(projects)
    setSpaceStatsReady(false)
    const [membersResult, invitesResult, keysResult] = await Promise.all([
      supabase
        .from('project_members')
        .select('project_id')
        .in('project_id', ids),
      supabase
        .from('project_invites')
        .select('project_id, status')
        .in('project_id', ids),
      supabase
        .from('client_api_keys')
        .select('project_id, status')
        .in('project_id', ids),
    ])

    const firstError = membersResult.error ?? invitesResult.error ?? keysResult.error
    if (firstError) {
      setSpaceStats(base)
      setSpaceStatsReady(false)
      return
    }

    for (const row of (membersResult.data ?? []) as Array<{ project_id: string | null }>) {
      if (row.project_id && base[row.project_id]) base[row.project_id].members += 1
    }
    for (const row of (invitesResult.data ?? []) as Array<{ project_id: string | null; status: string | null }>) {
      if (row.project_id && base[row.project_id] && row.status === 'pending') base[row.project_id].pendingInvites += 1
    }
    for (const row of (keysResult.data ?? []) as Array<{ project_id: string | null; status: string | null }>) {
      if (row.project_id && base[row.project_id] && row.status === 'active') base[row.project_id].activeKeys += 1
    }

    setSpaceStats(base)
    setSpaceStatsReady(true)
  }, [projects])

  useEffect(() => {
    void loadSpaceStats()
  }, [loadSpaceStats])

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
  const selectedStats = selectedProject ? spaceStats[selectedProject.id] ?? null : null
  const pendingInvites = invites.filter(invite => invite.status === 'pending')
  const spacesNeedingSetup = spaceStatsReady ? projects.filter(project => (spaceStats[project.id]?.activeKeys ?? 0) === 0).length : null
  const pendingInviteTotal = spaceStatsReady ? Object.values(spaceStats).reduce((sum, stats) => sum + stats.pendingInvites, 0) : null
  const activeKeyTotal = spaceStatsReady ? Object.values(spaceStats).reduce((sum, stats) => sum + stats.activeKeys, 0) : null

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
    const ok = window.confirm(`Remove ${project.name} from active spaces? Its history stays archived.`)
    if (!ok) return
    setBusyAction('archive-client')
    const { error } = await supabase.from('projects').update({ is_archived: true }).eq('id', project.id)
    setBusyAction(null)
    if (error) {
      push({ kind: 'danger', title: 'Space remove failed', body: error.message })
      return
    }
    push({ kind: 'success', title: 'Space removed', body: `${project.name} was archived.` })
    setSelectedProjectId(null)
    refetch()
  }

  function openClient(project: Project) {
    switchProject(project.slug)
    navigate(`/p/${project.slug}/vera`)
  }

  async function openObservation(obs: ShelfObservation) {
    const project = obs.project_id ? projectById.get(obs.project_id) ?? null : null
    if (project) {
      setSelectedProjectId(project.id)
      switchProject(project.slug)
    }

    if (obs.action_kind === 'open_integrations') {
      await markObservationActioned(obs, 'opened_integrations')
      navigate(integrationsRoute(obs, project?.id ?? selectedProject?.id ?? null))
      return
    }

    if (obs.action_kind === 'review_weekly_learning' || obs.kind === 'weekly_learning') {
      navigate(weeklyLearningRoute(obs, project?.slug ?? null) ?? (project ? `/p/${project.slug}/learning` : '/learning'))
      return
    }

    if (obs.action_kind === 'prompt_knowledge_input') {
      navigate(project ? `/p/${project.slug}/knowledge` : '/knowledge')
      return
    }

    if (obs.action_kind === 'draft_from_campaign') {
      navigate(project ? `/p/${project.slug}/vera` : '/vera')
      return
    }

    navigate(project ? `/p/${project.slug}/vera` : '/vera')
  }

  async function dismissObservation(obs: ShelfObservation) {
    setBusyAction(`dismiss:${obs.id}`)
    const { error } = await supabase
      .from('agent_observations')
      .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
      .eq('id', obs.id)
    setBusyAction(null)

    if (error) {
      push({ kind: 'danger', title: 'Agenda item dismiss failed', body: error.message })
      return
    }
    await loadObservations()
  }

  async function markObservationActioned(obs: ShelfObservation, stage: string) {
    setBusyAction(`obs:${obs.id}`)
    const { error } = await supabase
      .from('agent_observations')
      .update({ status: 'actioned', actioned_at: new Date().toISOString(), acted_result: { stage } })
      .eq('id', obs.id)
    setBusyAction(null)

    if (error) {
      push({ kind: 'danger', title: 'Agenda item update failed', body: error.message })
      return
    }
    await loadObservations()
  }

  if (!loading && projects.length === 0) {
    return (
      <div style={{ padding: space[8], maxWidth: 940 }}>
        <EmptyState
          icon={<FolderOpen size={22} strokeWidth={1.5} />}
          title="No spaces yet"
          body="Each space has its own brain, content, approvals, roles, and keys. Add your first space to begin."
          actions={<Button variant="primary" onClick={() => navigate('/onboarding')}>Add a space</Button>}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: space[8], maxWidth: 1220 }}>
      <PageHeader
        eyebrow={activeOrg?.name ?? 'Workspace'}
        title="Spaces"
        subtitle="Triage VERA's open work, then manage spaces, access, roles, invites, and provider keys."
        actions={
          <Button
            variant="primary"
            leading={<Plus size={14} />}
            onClick={() => navigate('/onboarding')}
          >
            Add space
          </Button>
        }
      />

      <AgendaPanel
        observations={observations}
        projectById={projectById}
        busyAction={busyAction}
        onOpen={openObservation}
        onDismiss={dismissObservation}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: space[4], marginBottom: space[7] }}>
        <Metric label="Spaces" value={projects.length} />
        <Metric label="Open agenda" value={observations.length} />
        <Metric label="Need setup" value={spacesNeedingSetup ?? 'Checking'} tone={spacesNeedingSetup && spacesNeedingSetup > 0 ? 'warn' : 'neutral'} />
        <Metric label="Pending invites" value={pendingInviteTotal ?? 'Checking'} tone={pendingInviteTotal && pendingInviteTotal > 0 ? 'accent' : 'neutral'} />
        <Metric label="Active keys" value={activeKeyTotal ?? 'Checking'} />
      </div>

      <div style={{ display: 'flex', gap: space[7], alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <aside style={{ flex: '1 1 320px', maxWidth: 390, minWidth: 280 }}>
          <SectionLabel count={orderedProjects.length} style={{ marginBottom: space[4] }}>Spaces</SectionLabel>
          <div style={panelStyle}>
            {orderedProjects.map(project => (
              <ClientRow
                key={project.id}
                project={project}
                selected={project.id === selectedProject?.id}
                openCount={obsByProject[project.id] ?? 0}
                stats={spaceStats[project.id] ?? null}
                statsReady={spaceStatsReady}
                onSelect={() => setSelectedProjectId(project.id)}
              />
            ))}
          </div>
        </aside>

        <main style={{ flex: '2 1 560px', minWidth: 0 }}>
          {!selectedProject ? (
            <EmptyState
              icon={<FolderOpen size={22} strokeWidth={1.5} />}
              title="Select a space"
              body="Choose a space to manage its access, invites, roles, and provider keys."
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

              <SpaceActionStrip
                project={selectedProject}
                openCount={selectedOpenCount}
                stats={selectedStats}
                statsReady={spaceStatsReady}
                onNavigate={path => navigate(path)}
              />

              {accessState === 'missing' && (
                <SetupPanel error={accessError} />
              )}

              {accessState === 'error' && (
                <ErrorPanel message={accessError ?? 'Space access could not load'} onRetry={loadAccess} />
              )}

              {accessState === 'loading' && (
                <div style={{ ...panelStyle, padding: space[6], color: color.ink2, fontSize: t.size.sm }}>Loading space settings...</div>
              )}

              {accessState === 'ready' && (
                <>
                  <section style={panelStyle}>
                    <PanelTitle
                      icon={<Users size={16} />}
                      title="People and invitations"
                      subtitle="Invite people by email, assign roles, and manage space-level access."
                    />
                    <div style={{ padding: space[5], borderTop: `1px solid ${color.line}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 150px auto', gap: space[3], alignItems: 'end' }}>
                        <Field label="Email">
                          <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="person@example.com" />
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
                          No space-specific people yet.
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
                          No provider keys saved for this space.
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

function AgendaPanel({
  observations,
  projectById,
  busyAction,
  onOpen,
  onDismiss,
}: {
  observations: ShelfObservation[]
  projectById: Map<string, Project>
  busyAction: string | null
  onOpen: (obs: ShelfObservation) => void
  onDismiss: (obs: ShelfObservation) => void
}) {
  const shown = observations.slice(0, 8)

  return (
    <section style={{ ...panelStyle, marginBottom: space[7], overflow: 'hidden' }}>
      <div style={{ padding: space[5], display: 'flex', gap: space[4], justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2] }}>
            <Sparkles size={15} color={color.accent} />
            <SectionLabel count={observations.length}>VERA agenda</SectionLabel>
          </div>
          <p style={{ margin: 0, maxWidth: 700, color: color.ink2, fontSize: t.size.sm, lineHeight: t.lineHeight.relaxed }}>
            Open connector issues, learning reviews, knowledge gaps, and draft opportunities across every space.
          </p>
        </div>
        {observations.length > shown.length && (
          <StatusPill tone="muted">Showing {shown.length} of {observations.length}</StatusPill>
        )}
      </div>

      {shown.length === 0 ? (
        <div style={{ borderTop: `1px solid ${color.line}`, padding: space[5], color: color.ghost, fontSize: t.size.sm }}>
          No open VERA agenda items across spaces.
        </div>
      ) : (
        <div>
          {shown.map(obs => {
            const project = obs.project_id ? projectById.get(obs.project_id) ?? null : null
            const tone = severityTone(obs.severity)
            return (
              <div
                key={obs.id}
                style={{
                  ...rowStyle,
                  alignItems: 'flex-start',
                  background: tone === 'danger' ? 'rgba(185,28,28,0.035)' : color.surface,
                }}
              >
                <span style={{
                  width: 28,
                  height: 28,
                  borderRadius: radius.sm,
                  background: tone === 'danger' ? 'rgba(185,28,28,0.10)' : color.paper2,
                  color: tone === 'danger' ? color.danger : severityColor(obs.severity),
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {tone === 'danger' ? <AlertTriangle size={15} /> : <Sparkles size={14} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
                    <span style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{obs.title}</span>
                    <StatusPill tone={tone}>{severityLabel(obs.severity)}</StatusPill>
                    {project && <span style={{ color: color.ghost, fontSize: t.size.cap }}>{project.name}</span>}
                    <span style={{ color: color.faint, fontSize: t.size.cap }}>{relativeDate(obs.created_at)}</span>
                  </div>
                  {obs.detail && (
                    <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.cap, lineHeight: t.lineHeight.relaxed }}>
                      {obs.detail}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    leading={<ArrowRight size={13} />}
                    loading={busyAction === `obs:${obs.id}`}
                    onClick={() => onOpen(obs)}
                  >
                    {agendaActionLabel(obs)}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leading={<XCircle size={13} />}
                    loading={busyAction === `dismiss:${obs.id}`}
                    onClick={() => onDismiss(obs)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ClientRow({
  project,
  selected,
  openCount,
  stats,
  statsReady,
  onSelect,
}: {
  project: Project
  selected: boolean
  openCount: number
  stats: SpaceStats | null
  statsReady: boolean
  onSelect: () => void
}) {
  const hasKeys = statsReady ? (stats?.activeKeys ?? 0) > 0 : true
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
        {statsReady && (
          <span style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginTop: space[2] }}>
            <span style={{ color: hasKeys ? color.success : color.warn, fontSize: t.size.micro, fontWeight: t.weight.medium }}>
              {stats?.activeKeys ?? 0} active key{(stats?.activeKeys ?? 0) === 1 ? '' : 's'}
            </span>
            <span style={{ color: color.faint, fontSize: t.size.micro }}>·</span>
            <span style={{ color: color.ghost, fontSize: t.size.micro }}>
              {stats?.members ?? 0} people
            </span>
            {(stats?.pendingInvites ?? 0) > 0 && (
              <>
                <span style={{ color: color.faint, fontSize: t.size.micro }}>·</span>
                <span style={{ color: color.accent, fontSize: t.size.micro }}>
                  {stats?.pendingInvites} pending
                </span>
              </>
            )}
          </span>
        )}
      </span>
      {!hasKeys && <StatusPill tone="warn">Setup</StatusPill>}
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
            {project.description || 'Space settings, access, and provider configuration.'}
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

function SpaceActionStrip({
  project,
  openCount,
  stats,
  statsReady,
  onNavigate,
}: {
  project: Project
  openCount: number
  stats: SpaceStats | null
  statsReady: boolean
  onNavigate: (path: string) => void
}) {
  const base = `/p/${project.slug}`
  const activeKeys = statsReady ? stats?.activeKeys ?? 0 : null
  const people = statsReady ? stats?.members ?? 0 : null
  const pending = statsReady ? stats?.pendingInvites ?? 0 : null
  const items = [
    { label: 'Command', detail: 'Research and generate', icon: MessageSquare, path: `${base}/vera` },
    { label: 'Brain', detail: 'Strategy, tone, assumptions', icon: Brain, path: `${base}/brain` },
    { label: 'Review', detail: 'Approvals and feedback', icon: CheckSquare, path: `${base}/review` },
    { label: 'Calendar', detail: 'Schedule and campaigns', icon: CalendarDays, path: `${base}/calendar` },
    { label: 'Keys', detail: 'Model and media access', icon: KeyRound, path: `${base}/keys` },
  ]

  return (
    <section style={{ ...panelStyle, padding: space[4], display: 'grid', gap: space[4] }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: space[3] }}>
        <SpaceSignal label="Agenda" value={openCount} tone={openCount > 0 ? 'accent' : 'neutral'} />
        <SpaceSignal label="People" value={people ?? 'Checking'} />
        <SpaceSignal label="Pending invites" value={pending ?? 'Checking'} tone={pending && pending > 0 ? 'accent' : 'neutral'} />
        <SpaceSignal label="Active keys" value={activeKeys ?? 'Checking'} tone={activeKeys === 0 ? 'warn' : 'neutral'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: space[3] }}>
        {items.map(item => (
          <SpaceActionButton key={item.label} {...item} onNavigate={onNavigate} />
        ))}
      </div>
    </section>
  )
}

function SpaceSignal({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'accent' | 'warn' | 'neutral' }) {
  const valueColor = tone === 'accent' ? color.accent : tone === 'warn' ? color.warn : color.ink
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: color.ghost, fontSize: t.size.micro, fontWeight: t.weight.medium, textTransform: 'uppercase', letterSpacing: 0 }}>{label}</div>
      <div style={{ color: valueColor, fontSize: t.size.h4, lineHeight: t.lineHeight.snug, fontWeight: t.weight.semibold, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function SpaceActionButton({
  label,
  detail,
  icon: Icon,
  path,
  onNavigate,
}: {
  label: string
  detail: string
  icon: React.ElementType
  path: string
  onNavigate: (path: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(path)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[3],
        minHeight: 58,
        padding: `${space[3]} ${space[4]}`,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        background: color.paper2,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: t.family.sans,
      }}
    >
      <span style={{
        width: 30,
        height: 30,
        borderRadius: radius.sm,
        background: color.surface,
        color: color.accent,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={15} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <span style={{ display: 'block', color: color.ghost, fontSize: t.size.cap, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
      </span>
    </button>
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

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'accent' | 'warn' | 'neutral' }) {
  const valueColor = tone === 'accent' ? color.accent : tone === 'warn' ? color.warn : color.ink
  return (
    <div style={{ ...panelStyle, padding: space[4] }}>
      <div style={{ fontSize: t.size.cap, color: color.ghost, fontWeight: t.weight.medium }}>{label}</div>
      <div style={{ marginTop: space[1], fontSize: t.size.h3, lineHeight: t.lineHeight.snug, color: valueColor, fontWeight: t.weight.semibold }}>{value}</div>
    </div>
  )
}

function SetupPanel({ error }: { error: string | null }) {
  return (
    <section style={{ ...panelStyle, padding: space[6] }}>
      <div style={{ display: 'flex', gap: space[3], alignItems: 'flex-start' }}>
        <ShieldCheck size={18} color={color.accent} />
        <div>
          <h3 style={{ margin: 0, color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>Space access schema needed</h3>
          <p style={{ margin: `${space[2]} 0 0`, color: color.ink2, fontSize: t.size.sm, lineHeight: t.lineHeight.relaxed }}>
            Apply the space access migration to enable invitations, roles, and API key management.
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
      <h3 style={{ margin: 0, color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold }}>Space settings could not load</h3>
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

function createSpaceStats(projects: Project[]) {
  return Object.fromEntries(
    projects.map(project => [project.id, { members: 0, pendingInvites: 0, activeKeys: 0 }]),
  ) as Record<string, SpaceStats>
}

function severityRank(severity: string) {
  if (severity === 'high') return 0
  if (severity === 'medium') return 1
  if (severity === 'low') return 2
  return 3
}

function severityTone(severity: string): 'accent' | 'success' | 'warn' | 'danger' | 'muted' {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warn'
  if (severity === 'low') return 'muted'
  return 'accent'
}

function severityColor(severity: string) {
  if (severity === 'high') return color.danger
  if (severity === 'medium') return color.warn
  if (severity === 'low') return color.ghost
  return color.accent
}

function severityLabel(severity: string) {
  if (severity === 'high') return 'Needs attention'
  if (severity === 'medium') return 'Watch'
  if (severity === 'low') return 'Low'
  return severity || 'Open'
}

function agendaActionLabel(obs: ShelfObservation) {
  if (obs.action_kind === 'open_integrations') return 'Open integration'
  if (obs.action_kind === 'review_weekly_learning' || obs.kind === 'weekly_learning') return 'Review learning'
  if (obs.action_kind === 'prompt_knowledge_input') return 'Open brain'
  if (obs.action_kind === 'draft_from_campaign') return 'Open VERA'
  return obs.proposed_action ? 'Open' : 'Open space'
}

function weeklyLearningRoute(obs: ShelfObservation, projectSlug: string | null) {
  const payload = obs.action_payload ?? {}
  if (typeof payload.route === 'string' && payload.route.startsWith('/')) return payload.route
  return projectSlug ? `/p/${projectSlug}/learning` : null
}

function integrationsRoute(obs: ShelfObservation, activeProjectId: string | null) {
  const payload = obs.action_payload ?? {}
  const provider = typeof payload.provider === 'string' ? payload.provider : null
  const projectId = typeof payload.project_id === 'string' ? payload.project_id : activeProjectId
  const params = new URLSearchParams({ tab: 'integrations' })
  if (provider) params.set('provider', provider)
  if (projectId) params.set('project_id', projectId)
  return `/settings?${params.toString()}`
}

function relativeDate(value: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const diff = Date.now() - time
  const minutes = Math.max(0, Math.floor(diff / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(value)
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
