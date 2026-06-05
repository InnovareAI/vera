// Super-admin (platform/master) source of truth — mirrors SAM's
// lib/constants/admin-emails.ts (ADR-012 "Agency Mode").
//
// Super-admin is a DOMAIN check, not a list: every @innovareai.com staff email
// is a platform admin who can oversee + enter any tenant (org) without a
// membership row. InnovareAI is the master tenant; everyone else is scoped to
// their own org. Keeping this identical to SAM means the two apps share one
// mental model and one policy.

export const SUPER_ADMIN_DOMAIN = 'innovareai.com' as const

// Individual emails granted super-admin outside the domain. Keep empty unless
// the user has explicitly approved an external admin.
export const SUPER_ADMIN_EXTRA_EMAILS: readonly string[] = []

/** True if the email is a platform/master super-admin (InnovareAI staff). */
export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.trim().toLowerCase()
  if (SUPER_ADMIN_EXTRA_EMAILS.includes(e)) return true
  return e.endsWith(`@${SUPER_ADMIN_DOMAIN}`)
}
