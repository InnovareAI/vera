import type { AdminClient } from "./auth.ts"
import {
  assertVeraChatMessageWritable,
  authorizeVeraChatMemberRequest,
  resolveEffectiveVeraChatUserId,
} from "./vera-chat-auth.ts"

type Row = Record<string, unknown>
type TableName = "projects" | "org_members" | "project_members" | "chat_messages"

const ORG_A = "11111111-1111-4111-8111-111111111111"
const ORG_B = "22222222-2222-4222-8222-222222222222"
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER_A = "33333333-3333-4333-8333-333333333333"
const USER_B = "44444444-4444-4444-8444-444444444444"
const SESSION_A = "55555555-5555-4555-8555-555555555555"
const MESSAGE_A = "66666666-6666-4666-8666-666666666666"
const SERVICE_KEY = "service-secret"
const CORS = { "Access-Control-Allow-Origin": "*" }

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
  auth = {
    getUser: (token: string) => {
      if (token === "token-user-a") {
        return Promise.resolve({ data: { user: { id: USER_A, email: "Operator@InnovareAI.com" } }, error: null })
      }
      if (token === "token-user-b") {
        return Promise.resolve({ data: { user: { id: USER_B, email: "client@example.com" } }, error: null })
      }
      return Promise.resolve({ data: { user: null }, error: new Error("invalid token") })
    },
  }

  constructor(private tables: Record<TableName, Row[]>) {}

  from(table: TableName) {
    return new FakeQuery(this.tables[table] ?? [])
  }
}

Deno.test("authorizeVeraChatMemberRequest rejects missing auth and service role", async () => {
  const supabase = fakeSupabase(baseTables())

  const missing = await authorizeVeraChatMemberRequest(request(null), supabase, ORG_A, PROJECT_A, SERVICE_KEY, CORS)
  assertResponse(missing, 401, "Unauthorized")

  const service = await authorizeVeraChatMemberRequest(request(SERVICE_KEY), supabase, ORG_A, PROJECT_A, SERVICE_KEY, CORS)
  assertResponse(service, 401, "User session required")
})

Deno.test("authorizeVeraChatMemberRequest allows org members to use org client spaces", async () => {
  const supabase = fakeSupabase(baseTables({
    org_members: [{ org_id: ORG_A, user_id: USER_A, role: "owner" }],
  }))

  const result = await authorizeVeraChatMemberRequest(request("token-user-a"), supabase, ORG_A, PROJECT_A, SERVICE_KEY, CORS)

  assert(result.ok)
  assertEquals(result.userId, USER_A)
  assertEquals(result.email, "operator@innovareai.com")
})

Deno.test("authorizeVeraChatMemberRequest allows project members without org membership", async () => {
  const supabase = fakeSupabase(baseTables({
    project_members: [{ project_id: PROJECT_A, user_id: USER_B, role: "reviewer" }],
  }))

  const result = await authorizeVeraChatMemberRequest(request("token-user-b"), supabase, ORG_A, PROJECT_A, SERVICE_KEY, CORS)

  assert(result.ok)
  assertEquals(result.userId, USER_B)
})

Deno.test("authorizeVeraChatMemberRequest rejects cross-org project scope", async () => {
  const supabase = fakeSupabase(baseTables({
    org_members: [{ org_id: ORG_A, user_id: USER_A, role: "owner" }],
  }))

  const result = await authorizeVeraChatMemberRequest(request("token-user-a"), supabase, ORG_A, PROJECT_B, SERVICE_KEY, CORS)

  assertResponse(result, 403, "Forbidden")
})

Deno.test("authorizeVeraChatMemberRequest rejects users outside org and project", async () => {
  const supabase = fakeSupabase(baseTables())

  const result = await authorizeVeraChatMemberRequest(request("token-user-b"), supabase, ORG_A, PROJECT_A, SERVICE_KEY, CORS)

  assertResponse(result, 403, "Forbidden")
})

Deno.test("resolveEffectiveVeraChatUserId rejects mismatched body user_id", async () => {
  const access = { ok: true as const, userId: USER_A, email: "operator@innovareai.com", service: false as const }

  const result = await resolveEffectiveVeraChatUserId(access, USER_B, CORS)

  assertResponse(result, 403, "user_id does not match authenticated user")
})

Deno.test("assertVeraChatMessageWritable rejects cross-project message reuse", async () => {
  const supabase = fakeSupabase(baseTables({
    chat_messages: [{
      id: MESSAGE_A,
      org_id: ORG_A,
      project_id: PROJECT_A,
      session_id: SESSION_A,
      user_id: USER_A,
      role: "user",
    }],
  }))

  const result = await assertVeraChatMessageWritable(supabase, MESSAGE_A, {
    orgId: ORG_A,
    projectId: PROJECT_B,
    sessionId: SESSION_A,
    userId: USER_A,
    role: "user",
  }, CORS)

  assertResponse(result, 403, "Forbidden")
})

Deno.test("assertVeraChatMessageWritable allows same-scope existing messages", async () => {
  const supabase = fakeSupabase(baseTables({
    chat_messages: [{
      id: MESSAGE_A,
      org_id: ORG_A,
      project_id: PROJECT_A,
      session_id: SESSION_A,
      user_id: USER_A,
      role: "assistant",
    }],
  }))

  const result = await assertVeraChatMessageWritable(supabase, MESSAGE_A, {
    orgId: ORG_A,
    projectId: PROJECT_A,
    sessionId: SESSION_A,
    userId: USER_A,
    role: "assistant",
  }, CORS)

  assert(result.ok)
})

function baseTables(overrides: Partial<Record<TableName, Row[]>> = {}): Record<TableName, Row[]> {
  return {
    projects: [
      { id: PROJECT_A, org_id: ORG_A },
      { id: PROJECT_B, org_id: ORG_B },
    ],
    org_members: [],
    project_members: [],
    chat_messages: [],
    ...overrides,
  }
}

function fakeSupabase(tables: Record<TableName, Row[]>): AdminClient {
  return new FakeSupabase(tables) as unknown as AdminClient
}

function request(token: string | null) {
  const headers = new Headers()
  if (token) headers.set("authorization", `Bearer ${token}`)
  return new Request("https://example.test/functions/v1/vera-chat", { method: "POST", headers })
}

async function responseJson(response: Response) {
  return await response.json() as { error?: string }
}

async function assertResponse(
  result: { ok: true } | { ok: false; response: Response },
  status: number,
  errorIncludes: string,
) {
  assert(!result.ok)
  assertEquals(result.response.status, status)
  const body = await responseJson(result.response)
  assert(body.error?.includes(errorIncludes), `Expected error to include ${errorIncludes}, got ${body.error}`)
}

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message)
}

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
