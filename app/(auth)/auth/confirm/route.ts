import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase";
import { buildRecoveryHref } from "@/lib/auth-return";
import {
  authFailureRedirect,
  completeAuthRedirect,
  finfoldSiteOrigin,
  readAuthCompletionParams
} from "@/lib/auth-callback-complete";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/**
 * GET /auth/confirm?token_hash=…&type=…&redirect_to=…
 *
 * Email-link landing that does NOT depend on the PKCE code verifier stored in
 * the browser that requested the email. Confirmation / recovery links opened
 * on another device, or inside WeChat / mail-app in-app browsers, would fail
 * the /auth/callback code exchange; verifyOtp(token_hash) works anywhere.
 *
 * Supabase email templates link here (see docs in the PR / report):
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&redirect_to={{ .RedirectTo }}
 *
 * `redirect_to` is our own /auth/callback URL (emailRedirectTo). Only its query
 * parameters (next, auth_mode, …) are read — never its origin — and `next` is
 * sanitized to an internal path exactly like /auth/callback. Templates may
 * insert it unencoded, so top-level params fill in anything it does not carry.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  // The global (finfold.app) and CN (finfold.cn) sites share one Supabase
  // project, so every email links to the single Site URL. Hop to the site the
  // user signed up on before verifying, so the session cookie lands there.
  const home = finfoldSiteOrigin(url.searchParams.get("redirect_to"));
  if (home && home !== url.origin && !url.searchParams.has("hop")) {
    const target = new URL(`/auth/confirm${url.search}`, home);
    target.searchParams.set("hop", "1");
    return Response.redirect(target.toString(), 303);
  }

  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const type = rawType && EMAIL_OTP_TYPES.has(rawType as EmailOtpType) ? rawType as EmailOtpType : null;

  const merged = mergeRedirectParams(url);
  if (type === "signup") {
    if (!merged.has("auth_mode")) merged.set("auth_mode", "signup");
    if (!merged.has("auth_method")) merged.set("auth_method", "email");
  }
  let params = readAuthCompletionParams(merged, url.origin);
  if (type === "recovery" && !params.isPasswordRecovery) {
    // A recovery link must always land on the new-password form.
    merged.set("next", buildRecoveryHref("/reset-password", merged.get("next")));
    params = readAuthCompletionParams(merged, url.origin);
  }

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
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

function mergeRedirectParams(url: URL): URLSearchParams {
  const merged = new URLSearchParams();
  const redirectTo = url.searchParams.get("redirect_to");
  if (redirectTo) {
    try {
      new URL(redirectTo).searchParams.forEach((value, key) => {
        if (!merged.has(key)) merged.set(key, value);
      });
    } catch {
      // Malformed redirect_to: fall back to top-level params only.
    }
  }
  url.searchParams.forEach((value, key) => {
    if (key === "token_hash" || key === "type" || key === "redirect_to" || key === "hop") return;
    if (!merged.has(key)) merged.set(key, value);
  });
  return merged;
}
