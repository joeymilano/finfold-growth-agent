/**
 * Whether an account already has a password the user must confirm before
 * changing it. Email signups carry an "email" provider/identity; accounts that
 * started with Google or GitHub only have one after /api/auth/password set it,
 * which records app_metadata.password_set (server-only, not user-editable).
 */
export function accountHasPassword(user: {
  app_metadata?: Record<string, unknown> | null;
  identities?: Array<{ provider?: string }> | null;
}): boolean {
  const meta = user.app_metadata ?? {};
  if (meta.password_set === true) return true;
  const providers = meta.providers;
  if (Array.isArray(providers) && providers.includes("email")) return true;
  if (meta.provider === "email") return true;
  return Boolean(user.identities?.some((identity) => identity.provider === "email"));
}
