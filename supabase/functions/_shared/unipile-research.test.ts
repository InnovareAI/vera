import { resolveUnipileResearchConnection } from "./unipile-research.ts"
import type { AdminClient } from "./auth.ts"

type Row = Record<string, unknown>
type TableName = "organizations" | "org_members"

class FakeQuery {
  private rows: Row[]
  private limitCount: number | null = null

  constructor(rows: Row[]) {
    this.rows = [...rows]
  }

  select(_columns: string) {
    return this
  }

  eq(column: string, value: unknown) {
    this.rows = this.rows.filter(row => row[column] === value)
    return this
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.rows = this.rows.filter(row => row[column] !== null && row[column] !== undefined)
    }
    return this
  }

  in(column: string, values: unknown[]) {
    const allowed = new Set(values)
    this.rows = this.rows.filter(row => allowed.has(row[column]))
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    const direction = options?.ascending === false ? -1 : 1
    this.rows = [...this.rows].sort((left, right) => {
      const a = String(left[column] ?? "")
      const b = String(right[column] ?? "")
      return a.localeCompare(b) * direction
    })
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  maybeSingle() {
    const rows = this.limitCount === null ? this.rows : this.rows.slice(0, this.limitCount)
    return Promise.resolve({ data: rows[0] ?? null, error: null })
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const rows = this.limitCount === null ? this.rows : this.rows.slice(0, this.limitCount)
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  constructor(private tables: Record<TableName, Row[]>) {}

  from(table: TableName) {
    return new FakeQuery(this.tables[table] ?? [])
  }
}

Deno.test("resolveUnipileResearchConnection prefers a usable workspace profile", async () => {
  const supabase = fakeSupabase({
    organizations: [
      org({ id: "client-org", unipile_account_id: "workspace-account", unipile_health_status: "healthy" }),
      org({ id: "master-org", is_master: true, unipile_account_id: "platform-account", updated_at: "2026-06-13T00:00:00Z" }),
    ],
    org_members: [
      { org_id: "master-org", user_id: "operator-user" },
    ],
  })

  const result = await resolveUnipileResearchConnection(supabase, "client-org", {
    requesterUserId: "operator-user",
  })

  assert(result.ok)
  assertEquals(result.accountId, "workspace-account")
  assertEquals(result.source, "workspace")
})

Deno.test("resolveUnipileResearchConnection allows InnovareAI operators to use the platform profile", async () => {
  const supabase = fakeSupabase({
    organizations: [
      org({ id: "client-org", unipile_account_id: null }),
      org({ id: "master-org", name: "InnovareAI", is_master: true, unipile_account_id: "platform-account", updated_at: "2026-06-13T00:00:00Z" }),
    ],
    org_members: [
      { org_id: "master-org", user_id: "operator-user" },
    ],
  })

  const result = await resolveUnipileResearchConnection(supabase, "client-org", {
    requesterUserId: "operator-user",
  })

  assert(result.ok)
  assertEquals(result.accountId, "platform-account")
  assertEquals(result.source, "platform")
  assert(result.detail.includes("InnovareAI"))
})

Deno.test("resolveUnipileResearchConnection denies platform fallback without an operator user", async () => {
  const supabase = fakeSupabase({
    organizations: [
      org({ id: "client-org", unipile_account_id: null }),
      org({ id: "master-org", is_master: true, unipile_account_id: "platform-account", updated_at: "2026-06-13T00:00:00Z" }),
    ],
    org_members: [
      { org_id: "master-org", user_id: "operator-user" },
    ],
  })

  const result = await resolveUnipileResearchConnection(supabase, "client-org")

  assert(!result.ok)
  assert(result.error.includes("No workspace LinkedIn research profile is connected"))
})

Deno.test("resolveUnipileResearchConnection denies platform fallback to non-operators", async () => {
  const supabase = fakeSupabase({
    organizations: [
      org({ id: "client-org", unipile_account_id: null }),
      org({ id: "master-org", is_master: true, unipile_account_id: "platform-account", updated_at: "2026-06-13T00:00:00Z" }),
    ],
    org_members: [],
  })

  const result = await resolveUnipileResearchConnection(supabase, "client-org", {
    requesterUserId: "client-user",
  })

  assert(!result.ok)
  assert(result.error.includes("cannot use the shared InnovareAI research profile"))
})

Deno.test("resolveUnipileResearchConnection skips stale workspace and platform profiles", async () => {
  const supabase = fakeSupabase({
    organizations: [
      org({ id: "client-org", unipile_account_id: "workspace-account", unipile_health_status: "stale" }),
      org({ id: "master-org", is_master: true, unipile_account_id: "platform-account", unipile_health_status: "revoked", updated_at: "2026-06-13T00:00:00Z" }),
    ],
    org_members: [
      { org_id: "master-org", user_id: "operator-user" },
    ],
  })

  const result = await resolveUnipileResearchConnection(supabase, "client-org", {
    requesterUserId: "operator-user",
  })

  assert(!result.ok)
  assertEquals(result.error, "No usable shared InnovareAI LinkedIn research profile is connected.")
})

function fakeSupabase(tables: Record<TableName, Row[]>): AdminClient {
  return new FakeSupabase(tables) as unknown as AdminClient
}

function org(row: Partial<Row>): Row {
  return {
    id: "",
    name: null,
    is_master: false,
    unipile_account_id: null,
    unipile_health_status: null,
    unipile_connected_at: null,
    updated_at: "2026-06-12T00:00:00Z",
    ...row,
  }
}

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message)
}

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
