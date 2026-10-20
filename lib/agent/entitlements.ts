import type { createSupabaseAdminClient } from "@/lib/supabase";
import { getActiveSubscription, resolveEffectivePlan } from "@/lib/payment/entitlements";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export async function resolveAgentPlan(admin: AdminClient, userId: string) {
  const [{ data: profile }, { data: subscriptions }] = await Promise.all([
    admin.from("profiles").select("plan").eq("id", userId).maybeSingle(),
    admin
      .from("subscriptions")
      .select("status, current_period_end, payment_provider")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
  ]);

  const activeSubscription = getActiveSubscription(
    (subscriptions ?? []).map((subscription) => ({
      status: String(subscription.status ?? ""),
      currentPeriodEnd: subscription.current_period_end, provider: subscription.payment_provider
    }))
  );
  return resolveEffectivePlan(profile?.plan, activeSubscription);
}
