import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { PasswordRecoveryPanel } from "@/components/app-shell/PasswordRecoveryPanel";
import { buildAuthHref, buildRecoveryHref, sanitizeRecoveryReturnTo } from "@/lib/auth-return";

/**
 * /reset-password — the landing target of the Supabase recovery email.
 *
 * /auth/callback exchanges the recovery code for a session cookie first,
 * so a valid session here proves the user owns the email. No session
 * (direct visit, expired or already-used link) → back to the request form.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const returnTo = params.next ? sanitizeRecoveryReturnTo(params.next) : undefined;
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect(buildAuthHref("/login", returnTo));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const retry = new URL(buildRecoveryHref("/forgot-password", returnTo), "https://finfold.internal");
    retry.searchParams.set("error", "expired");
    redirect(`${retry.pathname}${retry.search}`);
  }

  return <PasswordRecoveryPanel mode="reset" returnTo={returnTo} />;
}
