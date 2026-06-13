import {
  parseProjectBusinessContext,
  projectHasLinkedInStrategy,
  resolveProjectAuditChannels,
  type ProjectSourceResolution,
} from "./project-sources.ts"
import type { AdminClient } from "./auth.ts"

type Row = Record<string, unknown>
type TableName = "projects" | "channel_profiles"

class FakeQuery {
  private rows: Row[]

  constructor(rows: Row[]) {
    this.rows = [...rows]
  }

  select(columns: string) {
    void columns
    return this
  }

  eq(column: string, value: unknown) {
    this.rows = this.rows.filter(row => row[column] === value)
    return this
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null })
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  constructor(private tables: Record<TableName, Row[]>) {}

  from(table: TableName) {
    return new FakeQuery(this.tables[table] ?? [])
  }
}

Deno.test("parseProjectBusinessContext reads source pull depth and all first-wave sources", () => {
  const context = parseProjectBusinessContext(`[[VERA_BUSINESS_CONTEXT]]
- Website: https://example.com
- LinkedIn company page: https://linkedin.com/company/example
- YouTube: https://youtube.com/@example
- Medium: https://medium.com/@example
- Quora: https://quora.com/profile/example
- Reddit: r/example
- Facebook page: https://facebook.com/example
- X profile: https://x.com/example
- Source pull depth: deep
- Active channels: blog, instagram
[[/VERA_BUSINESS_CONTEXT]]`)

  assertEquals(context.website, "https://example.com")
  assertEquals(context.linkedinCompany, "https://linkedin.com/company/example")
  assertEquals(context.youtube, "https://youtube.com/@example")
  assertEquals(context.medium, "https://medium.com/@example")
  assertEquals(context.quora, "https://quora.com/profile/example")
  assertEquals(context.reddit, "r/example")
  assertEquals(context.facebook, "https://facebook.com/example")
  assertEquals(context.x, "https://x.com/example")
  assertEquals(context.sourcePullDepth, "deep")
  assertEquals(context.activeChannels, "blog, instagram")
})

Deno.test("projectHasLinkedInStrategy lets explicit active channels override source URLs", () => {
  const withoutLinkedIn: ProjectSourceResolution = {
    project: {
      id: "project-1",
      org_id: "org-1",
      name: "Example",
      is_default: false,
      instructions: `[[VERA_BUSINESS_CONTEXT]]
- Website: https://example.com
- LinkedIn company page: https://linkedin.com/company/example
- Active channels: blog, instagram
[[/VERA_BUSINESS_CONTEXT]]`,
    },
    channels: [
      { channel: "blog", url: "https://example.com" },
      { channel: "linkedin_company", url: "https://linkedin.com/company/example" },
    ],
    source: "project_brain",
    sourcePullDepth: "standard",
  }

  const withLinkedIn: ProjectSourceResolution = {
    ...withoutLinkedIn,
    project: {
      ...withoutLinkedIn.project,
      instructions: `[[VERA_BUSINESS_CONTEXT]]
- Website: https://example.com
- LinkedIn company page: https://linkedin.com/company/example
- Active channels: blog, LinkedIn company page
[[/VERA_BUSINESS_CONTEXT]]`,
    },
  }

  assertEquals(projectHasLinkedInStrategy(withoutLinkedIn), false)
  assertEquals(projectHasLinkedInStrategy(withLinkedIn), true)
})

Deno.test("resolveProjectAuditChannels returns project channels and requested pull depth", async () => {
  const supabase = fakeSupabase({
    projects: [
      {
        id: "project-1",
        org_id: "org-1",
        name: "Example",
        is_default: false,
        instructions: `[[VERA_BUSINESS_CONTEXT]]
- Website: https://example.com
- LinkedIn profile: https://linkedin.com/in/example
- Source pull depth: light
[[/VERA_BUSINESS_CONTEXT]]`,
      },
    ],
    channel_profiles: [],
  })

  const result = await resolveProjectAuditChannels(supabase, "org-1", "project-1")

  assertEquals(result.source, "project_brain")
  assertEquals(result.sourcePullDepth, "light")
  assertEquals(result.channels.length, 2)
  assertEquals(result.channels[0].channel, "blog")
  assertEquals(result.channels[1].channel, "linkedin_personal")
})

Deno.test("resolveProjectAuditChannels defaults source depth when missing", async () => {
  const supabase = fakeSupabase({
    projects: [
      {
        id: "project-1",
        org_id: "org-1",
        name: "Example",
        is_default: false,
        instructions: `[[VERA_BUSINESS_CONTEXT]]
- Website: https://example.com
[[/VERA_BUSINESS_CONTEXT]]`,
      },
    ],
    channel_profiles: [],
  })

  const result = await resolveProjectAuditChannels(supabase, "org-1", "project-1")

  assertEquals(result.sourcePullDepth, "standard")
})

function fakeSupabase(tables: Record<TableName, Row[]>): AdminClient {
  return new FakeSupabase(tables) as unknown as AdminClient
}

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
