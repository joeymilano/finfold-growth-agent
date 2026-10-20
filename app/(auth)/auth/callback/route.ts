import { createSupabaseServerClient } from "@/lib/supabase";
import {
  authFailureRedirect,
  completeAuthRedirect,
  readAuthCompletionParams
} from "@/lib/auth-callback-complete";

/**
 * GET /auth/callback
 *
 * Completes the email-confirmation AND OAuth (Google) flow: exchanges the
 * `?code=` returned by Supabase for a session cookie, then redirects into the
 * app. PKCE codes only work in the browser that started the flow; email links
 * opened on another device or inside an in-app browser land on /auth/confirm
 * (token_hash) instead — see lib/auth-callback-complete.ts.
 *
 * Side effect: on the user's FIRST successful confirmation/login we send the
 * "founder welcome email" (see lib/founder-email.ts) after the redirect is
 * sent. Repeat visits are skipped via profiles.founder_email_sent_at, so OAuth
 * re-logins never re-trigger it.
 *
 * WHY we read the user from exchangeCodeForSession()'s return value instead of
 * calling getUser() again: the session cookie written by the code exchange is
 * meant for the browser's NEXT request. Within this same request a second
 * getUser() reads the (still-empty) request cookie and returns null, silently
 * skipping the founder email. exchangeCodeForSession already hands us the
 * authenticated user, so we pass it through directly and do all DB work with
 * the service-role (admin) client — independent of the request's cookie state.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const params = readAuthCompletionParams(url.searchParams, url.origin);

  if (code) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data.user?.email) {
        return completeAuthRedirect(
          request,
          url.origin,
          { id: data.user.id, email: data.user.email, created_at: data.user.created_at },
          params
        );
      }
    }
  }

  return authFailureRedirect(url.origin, params);
}
