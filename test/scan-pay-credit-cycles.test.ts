// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Real SQL for migration 126: scan-pay plans grant credits per paid 30-day
// window, and a refunded plan gives back what it granted.
const user = "00000000-0000-4000-8000-000000000001";
const FREE = 50;
const PLAN = 5000;
const DAY = 24 * 60 * 60 * 1000;
let db: PGlite;
const sql = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8");

const monthKey = () => new Date().toISOString().slice(0, 7);
const monthExpiry = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
};

async function ensure(planCredits = PLAN) {
  const { rows } = await db.query<{ key: string }>(
    "select public.ensure_cycle_plan_credits($1,$2,$3,$4,$5) as key",
    [user, planCredits, FREE, monthKey(), monthExpiry()]
  );
  return rows[0].key;
}
async function snapshot() {
  const { rows } = await db.query<{ s: { periodKey: string; used: number; available: number } | null }>(
    "select public.get_credit_allowance_snapshot($1) as s", [user]
  );
  return rows[0].s;
}
async function available() {
  return (await db.query<{ n: number }>("select get_available_credits($1) n", [user])).rows[0].n;
}
/** 059's invariant: every balance change has a matching ledger row. */
async function ledgerBalanced() {
  const { rows } = await db.query<{ remaining: number; delta: number }>(
    `select (select coalesce(sum(remaining),0)::int from credit_balances where user_id=$1) remaining,
            (select coalesce(sum(delta),0)::int from credit_transactions where user_id=$1) delta`, [user]
  );
  return rows[0].remaining === rows[0].delta;
}
async function scanPlan(endsAt: Date, provider = "zcwpay") {
  await db.query(
    `insert into subscriptions (user_id, payment_provider, status, current_period_end)
     values ($1,$2,'active',$3)
     on conflict (user_id, payment_provider) do update set status='active', current_period_end=excluded.current_period_end`,
    [user, provider, endsAt.toISOString()]
  );
}
async function spend(amount: number) {
  await db.query("select public.reserve_credits($1,$2,'contentKitBase','workbench',null)", [user, amount]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role;
    create table public.subscriptions(
      user_id uuid not null, payment_provider text not null, status text not null,
      current_period_end timestamptz, primary key (user_id, payment_provider));`);
  await db.exec(sql("044_credits_ledger.sql"));
  await db.exec(sql("060_credit_read_models.sql"));
  await db.exec(sql("105_plan_credit_upgrade_topup.sql"));
  await db.exec(sql("126_scan_pay_plan_credit_cycles.sql"));
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("truncate auth.users cascade; truncate subscriptions;");
  await db.query("insert into auth.users values($1)", [user]);
});

describe("scan-pay plan credit cycles (migration 126)", () => {
  it("keeps the calendar month for free and card users", async () => {
    expect(await ensure(FREE)).toBe(monthKey());
    await db.query("insert into subscriptions values ($1,'creem','active',null)", [user]);
    expect(await ensure(PLAN)).toBe(monthKey());
    expect(await available()).toBe(PLAN);
    expect((await snapshot())?.periodKey).toBe(monthKey());
  });

  it("grants one batch per paid 30-day window that expires with the window", async () => {
    const end = new Date(Date.now() + 30 * DAY - 60_000);
    await scanPlan(end);
    const key = await ensure();
    expect(key).toMatch(/^scan-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(await ensure()).toBe(key); // idempotent
    expect(await available()).toBe(PLAN + FREE);

    const { rows } = await db.query<{ expires_at: Date }>(
      "select expires_at from credit_balances where user_id=$1 and period_key=$2", [user, key]
    );
    expect(Math.abs(new Date(rows[0].expires_at).getTime() - end.getTime())).toBeLessThan(1000);
    expect((await snapshot())?.periodKey).toBe(key);
    expect(await ledgerBalanced()).toBe(true);
  });

  it("does not move the window when the plan is renewed early", async () => {
    const end = new Date(Date.now() + 10 * DAY);
    await scanPlan(end);
    const before = await ensure();
    await scanPlan(new Date(end.getTime() + 30 * DAY)); // renewal stacks exactly 30 days
    expect(await ensure()).toBe(before);
    expect(await available()).toBe(PLAN + FREE);
  });

  it("tops up the current window on an upgrade without granting twice", async () => {
    await scanPlan(new Date(Date.now() + 20 * DAY));
    await ensure(PLAN);
    await spend(300);
    await ensure(50000);
    expect(await available()).toBe(50000 + FREE - 300);
    expect(await ledgerBalanced()).toBe(true);
  });

  it("converts a month batch topped up before the migration without double-granting", async () => {
    // Earlier scan-pay code topped the calendar-month batch up to the paid allowance.
    await db.query("select public.grant_plan_credits($1,$2,$3,$4)", [user, PLAN, monthKey(), monthExpiry()]);
    await spend(1200);
    expect(await available()).toBe(PLAN - 1200);

    await scanPlan(new Date(Date.now() + 25 * DAY));
    await ensure();
    // Month batch back to the free baseline; paid spend carried into the window.
    expect(await available()).toBe(PLAN + FREE - 1200);
    expect((await snapshot())?.used).toBe(1200 - FREE);
    expect(await ledgerBalanced()).toBe(true);
    await ensure();
    expect(await available()).toBe(PLAN + FREE - 1200);
  });

  it("falls back to the calendar month once the scan-pay plan lapses", async () => {
    await scanPlan(new Date(Date.now() - DAY));
    expect(await ensure(FREE)).toBe(monthKey());
  });

  it("takes back unspent plan credits on refund and keeps the free allowance", async () => {
    await scanPlan(new Date(Date.now() + 28 * DAY), "alipay_qrcode");
    await ensure();
    await spend(700);
    const { rows } = await db.query<{ r: { revoked: number; consumedPaid: number } }>(
      "select public.revoke_paid_plan_credits($1,$2,$3::jsonb) r", [user, FREE, JSON.stringify({ order_id: "o-1" })]
    );
    // FIFO spends whichever batch expires first, so check the invariants:
    // nothing paid is left in the window, at most the free allowance remains.
    const left = await available();
    expect(left).toBeLessThanOrEqual(FREE);
    expect(rows[0].r.revoked).toBe(PLAN + FREE - 700 - left);
    const { rows: scan } = await db.query<{ remaining: number }>(
      "select remaining from credit_balances where user_id=$1 and period_key like 'scan-%'", [user]
    );
    expect(scan[0].remaining).toBe(0);
    expect(await ledgerBalanced()).toBe(true);
  });

  it("takes back a card plan's unspent month credits on refund", async () => {
    await db.query("insert into subscriptions values ($1,'creem','active',null)", [user]);
    await ensure(PLAN);
    await spend(20);
    await db.query("select public.revoke_paid_plan_credits($1,$2,null)", [user, FREE]);
    expect(await available()).toBe(FREE - 20);
    expect(await ledgerBalanced()).toBe(true);
  });
});
