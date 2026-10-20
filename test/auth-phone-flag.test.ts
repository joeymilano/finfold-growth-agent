import { describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
vi.mock("@/lib/supabase", () => ({
  hasSupabaseConfig: () => true,
  createSupabaseServerClient: vi.fn(async () => ({ auth: { signInWithOtp, verifyOtp: vi.fn() } }))
}));

import { POST as sendOtp } from "@/app/api/auth/phone/otp/route";
import { POST as verifyOtp } from "@/app/api/auth/phone/verify/route";
import { PHONE_AUTH_ENABLED } from "@/lib/auth-features";

describe("phone auth feature flag", () => {
  it.runIf(!PHONE_AUTH_ENABLED)("hides the paid SMS endpoints while the phone entry is off", async () => {
    const body = JSON.stringify({ phone: "+8613800138000", token: "123456" });
    const otp = await sendOtp(new Request("https://www.finfold.app/api/auth/phone/otp", { method: "POST", body }));
    const verify = await verifyOtp(new Request("https://www.finfold.app/api/auth/phone/verify", { method: "POST", body }));
    expect(otp.status).toBe(404);
    expect(verify.status).toBe(404);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
