import { isPlatformMediaProject } from "./client-media-keys.ts"
import type { AdminClient } from "./auth.ts"

type Row = Record<string, unknown>
type TableName = "projects" | "organizations"

class FakeQuery {
  private rows: Row[]

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

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null })
  }
}

class FakeSupabase {
  constructor(private tables: Record<TableName, Row[]>) {}

  from(table: TableName) {
    return new FakeQuery(this.tables[table] ?? [])
  }
}

Deno.test("isPlatformMediaProject allows only an allowlisted master-org project with policy enabled", async () => {
  const supabase = fakeSupabase({
    projects: [
      project({
        id: "innovare-project",
        slug: "innovareai-brand",
        org_id: "master-org",
        ai_policy: { platform_media_keys_enabled: true },
      }),
    ],
    organizations: [
      { id: "master-org", is_master: true },
    ],
  })

  const allowed = await isPlatformMediaProject(supabase, "innovare-project", "master-org")

  assertEquals(allowed, true)
})

Deno.test("isPlatformMediaProject denies non-allowlisted client projects even inside the master org", async () => {
  const supabase = fakeSupabase({
    projects: [
      project({
        id: "rdf-project",
        slug: "rdf-style",
        org_id: "master-org",
        ai_policy: { platform_media_keys_enabled: true },
      }),
    ],
    organizations: [
      { id: "master-org", is_master: true },
    ],
  })

  const allowed = await isPlatformMediaProject(supabase, "rdf-project", "master-org")

  assertEquals(allowed, false)
})

Deno.test("isPlatformMediaProject denies allowlisted projects when policy is not enabled", async () => {
  const supabase = fakeSupabase({
    projects: [
      project({
        id: "innovare-project",
        slug: "innovareai-brand",
        org_id: "master-org",
        ai_policy: { platform_media_keys_enabled: false },
      }),
    ],
    organizations: [
      { id: "master-org", is_master: true },
    ],
  })

  const allowed = await isPlatformMediaProject(supabase, "innovare-project", "master-org")

  assertEquals(allowed, false)
})

Deno.test("isPlatformMediaProject denies allowlisted slugs outside a master org", async () => {
  const supabase = fakeSupabase({
    projects: [
      project({
        id: "client-project",
        slug: "innovareai-brand",
        org_id: "client-org",
        ai_policy: { platform_media_keys_enabled: true },
      }),
    ],
    organizations: [
      { id: "client-org", is_master: false },
    ],
  })

  const allowed = await isPlatformMediaProject(supabase, "client-project", "client-org")

  assertEquals(allowed, false)
})

function fakeSupabase(tables: Record<TableName, Row[]>): AdminClient {
  return new FakeSupabase(tables) as unknown as AdminClient
}

function project(row: Partial<Row>): Row {
  return {
    id: "",
    slug: "",
    org_id: "",
    ai_policy: {},
    ...row,
  }
}

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
