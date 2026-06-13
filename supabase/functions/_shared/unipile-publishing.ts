type JsonRecord = Record<string, unknown>

export type UnipileClientIntegrationLike = {
  config?: JsonRecord | null
  external_ref?: JsonRecord | null
}

export type LinkedInOrganizationResolution =
  | { ok: true; asOrganization?: string }
  | { ok: false; status: 403; message: string }

export function getUnipileAccountId(integration: UnipileClientIntegrationLike | null): string | null {
  return firstString(
    integration?.external_ref?.unipile_account_id,
    integration?.config?.unipile_account_id,
    integration?.external_ref?.account_id,
  )
}

export function linkedInOrganizationForIntegration(integration: UnipileClientIntegrationLike | null): string | null {
  return firstString(
    integration?.external_ref?.linkedin_organization_id,
    integration?.external_ref?.linkedin_company_id,
    integration?.external_ref?.as_organization,
    integration?.external_ref?.organization_id,
    integration?.config?.linkedin_organization_id,
    integration?.config?.linkedin_company_id,
    integration?.config?.as_organization,
    integration?.config?.organization_id,
  )
}

export function resolveClientLinkedInOrganization(
  integration: UnipileClientIntegrationLike | null,
  explicitOrgUrn?: string | null,
): LinkedInOrganizationResolution {
  const allowedOrganization = linkedInOrganizationForIntegration(integration)
  const explicit = typeof explicitOrgUrn === "string" && explicitOrgUrn.trim()
    ? explicitOrgUrn.trim()
    : null

  if (explicit) {
    if (!allowedOrganization || normalizeLinkedInOrgId(explicit) !== normalizeLinkedInOrgId(allowedOrganization)) {
      return {
        ok: false,
        status: 403,
        message: "LinkedIn company page is not connected to this client space.",
      }
    }
    return { ok: true, asOrganization: allowedOrganization }
  }

  return allowedOrganization ? { ok: true, asOrganization: allowedOrganization } : { ok: true }
}

export function normalizeLinkedInOrgId(value: string): string {
  return value.trim().replace(/^urn:li:organization:/i, "").replace(/^urn:linkedin:organization:/i, "")
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}
