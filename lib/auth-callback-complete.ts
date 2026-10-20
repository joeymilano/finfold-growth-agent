import { after, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { sendFounderWelcome, type FounderLocale } from "@/lib/founder-email";
import { attributeReferral, readReferralCode, REFERRAL_COOKIE } from "@/lib/referrals";
import {
  buildAuthHref,
  buildRecoveryHref,
  resolveNewAccountReturnTo,
  sanitizeInternalReturnTo,
  wasRecentlyCreated
} from "@/lib/auth-return";
import { captureServerEvent } from "@/lib/posthog-server";
import { normalizeSignupFlowId, normalizeTrafficClass } from "@/lib/auth-callback-url";
import {
  NATIVE_VISITOR_COOKIE,
  recordNativeSignupOutcome
} from "@/lib/native-outcome-attribution";
import {
  createRecoveryGrant,
  RECOVERY_GRANT_COOKIE,
  recoveryGrantCookieOptions
} from "@/lib/auth-recovery-grant";

/**
 * Shared landing logic for /auth/callback (PKCE `code`) and /auth/confirm
 * (`token_hash` + `type`, works across devices and in-app browsers).
 */
export type AuthCompletionParams = {
  next: string;
  nextUrl: URL;
  authMode: "login" | "signup";
  authMethod: string;
  signupFlowId: string | null;
  trafficClass: "production" | "qa" | null;
  isPasswordRecovery: boolean;
};

export function readAuthCompletionParams(params: URLSearchParams, origin: string): AuthCompletionParams {
  const next = sanitizeInternalReturnTo(params.get("next"));
  const rawAuthMethod = params.get("auth_method") ?? "unknown";
  // Recovery links ask the callback to land on /reset-password; flag it so the
  // failure redirect and side effects stay password-recovery-specific.
  const nextUrl = new URL(next, origin);
  return {
    next,
    nextUrl,
    authMode: params.get("auth_mode") === "signup" ? "signup" : "login",
    authMethod: /^[a-z0-9_-]{1,32}$/i.test(rawAuthMethod) ? rawAuthMethod.toLowerCase() : "unknown",
    signupFlowId: normalizeSignupFlowId(params.get("signup_flow_id")),
    trafficClass: normalizeTrafficClass(params.get("traffic_class")),
    isPasswordRecovery: nextUrl.pathname === "/reset-password"
  };
}

/**
 * Anything went wrong → let the user retry without losing the original
 * product or ChatGPT authorization request they were completing. A failed
 * recovery exchange (expired / already-used link) retries from the email
 * request form instead — those users cannot sign in with the old password.
 * A failed signup confirmation usually means the link was already used or was
 * opened on another device after the address was verified, so say that.
 */
export function authFailureRedirect(origin: string, params: AuthCompletionParams): NextResponse {
  if (params.isPasswordRecovery) {
    const retryUrl = new URL(buildRecoveryHref("/forgot-password", params.nextUrl.searchParams.get("next")), origin);
    retryUrl.searchParams.set("error", "expired");
    return NextResponse.redirect(retryUrl);
  }
  const retryUrl = new URL(buildAuthHref("/login", params.next), origin);
  const isEmailConfirmation = params.authMode === "signup" && params.authMethod === "email";
  retryUrl.searchParams.set("error", isEmailConfirmation ? "email_confirm" : "oauth");
  return NextResponse.redirect(retryUrl);
}

type CompletedUser = { id: string; email: string; created_at?: string };

export async function completeAuthRedirect(
  request: Request,
  origin: string,
  user: CompletedUser,
  params: AuthCompletionParams
): Promise<NextResponse> {
  const { next, authMode, authMethod, signupFlowId, trafficClass, isPasswordRecovery } = params;

  // Referral attribution stays on the redirect path: the referral cookie is
  // deleted by this response, so it cannot be retried later.
  await attributeReferral({
    code: readReferralCode(request),
    referredUserId: user.id,
    userCreatedAt: user.created_at,
    request
  }).catch((referralError) =>
    console.error("[callback] referral attribution failed", referralError)
  );

  // A brand-new account (email confirmation, or an OAuth identity created just
  // now from either auth page) starts on the guided first task unless the
  // flow carried an explicit product target. Returning users keep `next`.
  const accountWasNew = authMethod === "email" || wasRecentlyCreated(user.created_at);
  const isOAuthMethod = authMethod !== "email" && authMethod !== "unknown";
  const landsAsNewAccount = !isPasswordRecovery
    && accountWasNew
    && (authMode === "signup" || isOAuthMethod);
  const destination = landsAsNewAccount ? resolveNewAccountReturnTo(next) : next;

  const analyticsProperties = {
    auth_mode: authMode,
    auth_method: authMethod,
    return_to: next,
    destination,
    completion_stage: "callback",
    account_was_new: accountWasNew,
    ...(signupFlowId ? { signup_flow_id: signupFlowId } : {}),
    ...(trafficClass
      ? {
          traffic_class: trafficClass,
          is_test_traffic: trafficClass === "qa" ? "true" : "false"
        }
      : {})
  };
  const completedNewSignup = authMode === "signup" && analyticsProperties.account_was_new;

  // Welcome email (up to 8s) and analytics (up to 2.5s each) are not needed
  // to render the landing page; run them after the redirect is sent.
  await runAfterResponse("post-auth side effects", async () => {
    await Promise.all([
      // Password recovery is never a "first login": skip it outright so a
      // user who never received the welcome can't get it mid-reset.
      isPasswordRecovery
        ? Promise.resolve()
        : maybeSendFounderWelcome(request, user.id, user.email).catch((e) =>
            console.error("[callback] founder email error", e)
          ),
      captureServerEvent(user.id, "auth_callback_completed", analyticsProperties),
      ...(completedNewSignup
        ? [captureServerEvent(user.id, "signup_completed", analyticsProperties)]
        : authMode === "signup"
          ? [captureServerEvent(user.id, "signup_existing_account_resumed", analyticsProperties)]
          : [])
    ]);
  });

  // Native outcome attribution decides whether the visitor cookie may be
  // cleared by this very response, so it has to finish first.
  let clearNativeVisitorCookie = false;
  if (completedNewSignup && trafficClass !== "qa") {
    const admin = createSupabaseAdminClient();
    if (admin) {
      try {
        await recordNativeSignupOutcome(admin, {
          request,
          subjectUserId: user.id,
          occurredAt: user.created_at ?? new Date().toISOString()
        });
        clearNativeVisitorCookie = true;
      } catch (outcomeError) {
        console.error("[callback] native outcome attribution failed", outcomeError);
      }
    }
  }

  const response = NextResponse.redirect(new URL(destination, origin));
  response.cookies.delete(REFERRAL_COOKIE);
  if (clearNativeVisitorCookie) response.cookies.delete(NATIVE_VISITOR_COOKIE);
  if (isPasswordRecovery) {
    const grant = await createRecoveryGrant(user.id);
    if (grant) {
      response.cookies.set(RECOVERY_GRANT_COOKIE, grant, {
        ...recoveryGrantCookieOptions,
        secure: new URL(origin).protocol === "https:"
      });
    }
  }
  return response;
}

/**
 * Hand non-critical work to the runtime's waitUntil (OpenNext maps Next's
 * after() onto the Cloudflare execution context). Outside a request scope —
 * unit tests, scripts — run it inline so nothing is silently dropped.
 */
async function runAfterResponse(label: string, task: () => Promise<unknown>): Promise<void> {
  const guarded = () => task().catch((error) => console.error(`[callback] ${label} failed`, error));
  try {
    after(guarded);
  } catch {
    await guarded();
  }
}

/**
 * Send the founder welcome email iff this user has never received it.
 *
 * Takes userId + email straight from the session exchange (no second
 * getUser() / cookie read). All lookups use the service-role admin client,
 * so this is fully independent of the request's session cookie state.
 *
 * De-dupe: profiles.founder_email_sent_at non-null → skip.
 * Locale resolution priority: profiles.locale → finfold-locale cookie → "zh".
 */
async function maybeSendFounderWelcome(
  request: Request,
  userId: string,
  email: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;

  const { data: profile } = await admin
    .from("profiles")
    .select("locale, founder_email_sent_at")
    .eq("id", userId)
    .maybeSingle();

  // Already sent → never re-send (covers OAuth re-logins, repeated callback hits).
  if (profile?.founder_email_sent_at) return;

  const cookieLocale = readLocaleCookie(request);
  const locale: FounderLocale =
    profile?.locale === "en" ? "en" : profile?.locale === "zh" ? "zh" : cookieLocale;

  const ok = await sendFounderWelcome({ to: email, locale });
  if (ok) {
    await admin
      .from("profiles")
      .update({ founder_email_sent_at: new Date().toISOString() })
      .eq("id", userId);
  }
}

function readLocaleCookie(request: Request): FounderLocale {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)finfold-locale=(zh|en)/);
  return match?.[1] === "en" ? "en" : "zh";
}

const FINFOLD_SITE_HOSTS = new Set([
  "finfold.app",
  "www.finfold.app",
  "staging.finfold.app",
  "finfold.cn",
  "www.finfold.cn"
]);

/** Origin of redirect_to when it is one of our own HTTPS sites, else null. */
export function finfoldSiteOrigin(redirectTo: string | null): string | null {
  if (!redirectTo) return null;
  try {
    const target = new URL(redirectTo);
    return target.protocol === "https:" && FINFOLD_SITE_HOSTS.has(target.hostname) ? target.origin : null;
  } catch {
    return null;
  }
}
