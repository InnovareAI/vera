import type { AdminClient } from "./auth.ts"
import { checkProjectAiBudget, shouldEnforceBudgetForOperation } from "./ai-policy.ts"

type Row = Record<string, unknown>
type TableName = "projects" | "generation_log" | "provider_model_pricing"

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG_ID = "11111111-1111-4111-8111-111111111111"

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

  gte(column: string, value: string) {
    this.rows = this.rows.filter(row => String(row[column] ?? "") >= value)
    return this
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null })
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  constructor(private tables: Record<TableName, Row[]>) {}

  from(table: TableName) {
    return new FakeQuery(this.tables[table] ?? [])
  }
}

Deno.test("shouldEnforceBudgetForOperation only blocks production generation spend", () => {
  assertEquals(shouldEnforceBudgetForOperation("image.generate"), true)
  assertEquals(shouldEnforceBudgetForOperation("video.submit"), true)
  assertEquals(shouldEnforceBudgetForOperation("campaign.plan"), true)
  assertEquals(shouldEnforceBudgetForOperation("paid_social.generate_ad"), true)
  assertEquals(shouldEnforceBudgetForOperation("research.reddit_listen"), false)
  assertEquals(shouldEnforceBudgetForOperation("audit.seo"), false)
  assertEquals(shouldEnforceBudgetForOperation("knowledge.embed"), false)
  assertEquals(shouldEnforceBudgetForOperation("chat.message"), false)
})

Deno.test("checkProjectAiBudget ignores research for budget guard decisions", async () => {
  const result = await checkProjectAiBudget(fakeSupabase(), PROJECT_ID, {
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    operation: "research.reddit_listen",
    inputTokens: 1_000,
    outputTokens: 1_000,
  })

  assert(result.ok)
  assertEquals(result.warning, null)
})

Deno.test("checkProjectAiBudget ignores onboarding and knowledge operations", async () => {
  const businessContext = await checkProjectAiBudget(fakeSupabase(), PROJECT_ID, {
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    provider: "openrouter",
    model: "google/gemini-2.5-flash",
    operation: "business_context.extract",
    inputTokens: 4_000,
    outputTokens: 2_000,
  })
  const embedding = await checkProjectAiBudget(fakeSupabase(), PROJECT_ID, {
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    provider: "openai",
    model: "text-embedding-3-small",
    operation: "knowledge.embed",
    inputTokens: 2_000,
    outputTokens: 0,
  })

  assert(businessContext.ok)
  assert(embedding.ok)
  assertEquals(businessContext.warning, null)
  assertEquals(embedding.warning, null)
})

Deno.test("checkProjectAiBudget blocks production media when enforce mode is over cap", async () => {
  const result = await checkProjectAiBudget(fakeSupabase(), PROJECT_ID, {
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    provider: "fal",
    model: "fal-ai/minimax/video-01",
    operation: "video.submit",
    metadata: { alias: "hailuo" },
  })

  assert(!result.ok)
  assert(result.message.includes("Generation budget reached"), result.message)
})

function fakeSupabase(): AdminClient {
  return new FakeSupabase({
    projects: [{
      id: PROJECT_ID,
      ai_policy: {
        budget_guard_enabled: true,
        budget_guard_mode: "enforce",
        monthly_budget_usd: 10,
      },
    }],
    generation_log: [{
      project_id: PROJECT_ID,
      created_at: new Date().toISOString(),
      cost_usd: 11,
    }],
    provider_model_pricing: [],
  }) as unknown as AdminClient
}

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message)
}

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
