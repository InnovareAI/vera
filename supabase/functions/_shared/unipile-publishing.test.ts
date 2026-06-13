import {
  getUnipileAccountId,
  linkedInOrganizationForIntegration,
  normalizeLinkedInOrgId,
  resolveClientLinkedInOrganization,
} from "./unipile-publishing.ts"

Deno.test("getUnipileAccountId reads project-scoped account ids from integration refs", () => {
  const accountId = getUnipileAccountId({
    external_ref: { unipile_account_id: "client-account" },
    config: { unipile_account_id: "fallback-account" },
  })

  assertEquals(accountId, "client-account")
})

Deno.test("linkedInOrganizationForIntegration reads the connected company page from client integration metadata", () => {
  const orgId = linkedInOrganizationForIntegration({
    external_ref: { linkedin_company_id: "urn:li:organization:12345" },
    config: {},
  })

  assertEquals(orgId, "urn:li:organization:12345")
})

Deno.test("resolveClientLinkedInOrganization auto-selects only the client integration company page", () => {
  const result = resolveClientLinkedInOrganization({
    external_ref: { linkedin_organization_id: "urn:li:organization:12345" },
  })

  assert(result.ok)
  assertEquals(result.asOrganization, "urn:li:organization:12345")
})

Deno.test("resolveClientLinkedInOrganization accepts explicit org ids only when they match the client integration", () => {
  const result = resolveClientLinkedInOrganization({
    external_ref: { linkedin_organization_id: "urn:li:organization:12345" },
  }, "urn:linkedin:organization:12345")

  assert(result.ok)
  assertEquals(result.asOrganization, "urn:li:organization:12345")
})

Deno.test("resolveClientLinkedInOrganization rejects cross-client company page ids", () => {
  const result = resolveClientLinkedInOrganization({
    external_ref: { linkedin_organization_id: "urn:li:organization:12345" },
  }, "urn:li:organization:99999")

  assert(!result.ok)
  assertEquals(result.status, 403)
  assertEquals(result.message, "LinkedIn company page is not connected to this client space.")
})

Deno.test("resolveClientLinkedInOrganization rejects explicit company posting without a client integration company id", () => {
  const result = resolveClientLinkedInOrganization({
    external_ref: { unipile_account_id: "client-account" },
  }, "urn:li:organization:12345")

  assert(!result.ok)
  assertEquals(result.status, 403)
})

Deno.test("normalizeLinkedInOrgId normalizes supported LinkedIn organization URN forms", () => {
  assertEquals(normalizeLinkedInOrgId("urn:li:organization:12345"), "12345")
  assertEquals(normalizeLinkedInOrgId("urn:linkedin:organization:12345"), "12345")
})

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message)
}

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
