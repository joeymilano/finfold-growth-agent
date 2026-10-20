import { signHmacSHA256, verifyHmacSHA256 } from "@/lib/payment/hmac";

/**
 * Password-recovery grant.
 *
 * The recovery email proves inbox ownership, so /api/auth/password lets that
 * session set a new password without the current one. A plain session cookie
 * cannot prove "this session came from a recovery link" (anyone holding a
 * stolen session could claim it), so the auth callback issues a short-lived,
 * HMAC-signed, httpOnly cookie bound to the user id. The key is derived from
 * the server-only service-role secret with a domain-separation prefix.
 */
export const RECOVERY_GRANT_COOKIE = "finfold-recovery-grant";
export const RECOVERY_GRANT_TTL_SECONDS = 30 * 60;
const DOMAIN = "finfold:password-recovery-grant:v1";

function grantSecret(): string | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return secret && secret.length >= 16 ? secret : null;
}

export async function createRecoveryGrant(userId: string, now = Date.now()): Promise<string | null> {
  const secret = grantSecret();
  if (!secret) return null;
  const expiresAt = Math.floor(now / 1000) + RECOVERY_GRANT_TTL_SECONDS;
  const signature = await signHmacSHA256(`${DOMAIN}:${userId}:${expiresAt}`, secret);
  return `${expiresAt}.${signature}`;
}

export async function verifyRecoveryGrant(
  value: string | null | undefined,
  userId: string,
  now = Date.now()
): Promise<boolean> {
  const secret = grantSecret();
  if (!secret || !value) return false;
  const match = /^(\d{1,12})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < now) return false;
  return verifyHmacSHA256(`${DOMAIN}:${userId}:${expiresAt}`, match[2], secret);
}

export const recoveryGrantCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/api/auth/password",
  maxAge: RECOVERY_GRANT_TTL_SECONDS
};

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
