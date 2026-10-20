import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { apiError } from "@/lib/i18n";

type RateLimitOptions = {
  scope: string;
  subject?: string;
  limit: number;
  windowMs: number;
};

/**
 * Fast per-isolate abuse brake for accidental bursts and basic scripts before
 * an upstream auth/AI provider is called. It intentionally makes no claim of
 * distributed enforcement.
 */
export function enforceApiRateLimit(request: Request, options: RateLimitOptions): NextResponse | null {
  const ip = options.subject ?? getClientIp(request);
  if (checkRateLimit(`${options.scope}:${ip}`, options.limit, options.windowMs)) {
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
  return NextResponse.json(
    { error: apiError(request.headers ?? new Headers(), "请求太频繁，请稍等片刻再试。", "Too many requests. Please wait and try again.") },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}
