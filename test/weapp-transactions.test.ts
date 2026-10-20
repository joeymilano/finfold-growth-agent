// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
const sql = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8");
const create = (requestId = "request-123", platform = "wechat") => db.query<{ result: { draft: { id: string }; created: boolean } }>(
  "select public.create_weapp_draft($1,$2,'free',null,$3::jsonb,$4) as result",
  [user, requestId, JSON.stringify({ title: "测试选题" }), platform]
);
async function credits() { return (await db.query<{ n: number }>("select get_available_credits($1) n", [user])).rows[0].n; }
async function fail(id: string) { return db.query("select fail_weapp_draft($1,'失败',false)", [id]); }

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role;
    create table public.topic_opportunities(id uuid primary key,user_id uuid);`);
  await db.exec(sql("044_credits_ledger.sql"));
  await db.exec(sql("123_weapp.sql").replace("create extension if not exists pgcrypto;", ""));
  await db.exec(sql("124_weapp_reliability.sql"));
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("truncate auth.users cascade");
  await db.query("insert into auth.users values($1),($2)", [user, other]);
  await db.query("select grant_weapp_signup_credits($1)", [user]);
});

describe("WeApp real SQL transaction boundaries", () => {
  it("creates once and charges once on replay and concurrent requests", async () => {
    const results = await Promise.all([create(), create(), create()]);
    expect(new Set(results.map((r) => r.rows[0].result.draft.id)).size).toBe(1);
    expect(results.filter((r) => r.rows[0].result.created)).toHaveLength(1);
    expect(await credits()).toBe(197);
    await expect(create("request-123", "moments")).rejects.toThrow("request_id_conflict");
    expect(await credits()).toBe(197);
  });
  it("rolls back reservation if draft insert fails", async () => {
    await expect(create("request-fail", "invalid-platform")).rejects.toThrow();
    expect(await credits()).toBe(200);
    expect((await db.query("select * from weapp_drafts")).rows).toHaveLength(0);
    expect((await db.query("select * from credit_transactions where delta<0")).rows).toHaveLength(0);
  });
  it("insufficient balance cannot partially consume", async () => {
    await db.query("update credit_balances set used=198 where user_id=$1", [user]);
    await expect(create()).rejects.toThrow("insufficient_credits");
    expect(await credits()).toBe(2);
  });
  it("failure and repeated timeout refund exactly once", async () => {
    const id = (await create()).rows[0].result.draft.id;
    await Promise.all([fail(id), fail(id)]);
    expect(await credits()).toBe(200);
    const row = (await db.query<{ status: string; credits_charged: number }>("select * from weapp_drafts where id=$1", [id])).rows[0];
    expect(row.status).toBe("failed");
    expect(row.credits_charged).toBe(0);
    expect((await db.query("select * from credit_transactions where action='refund'")).rows).toHaveLength(1);
  });
  it("a refund write failure leaves pending status and funds intact for retry", async () => {
    const id = (await create()).rows[0].result.draft.id;
    await db.exec("alter table credit_transactions add constraint simulate_refund_outage check (action <> 'refund')");
    try {
      await expect(fail(id)).rejects.toThrow();
      expect(await credits()).toBe(197);
      expect((await db.query<{ status: string; credits_charged: number }>("select status,credits_charged from weapp_drafts where id=$1", [id])).rows[0]).toEqual({ status: "pending", credits_charged: 3 });
    } finally { await db.exec("alter table credit_transactions drop constraint simulate_refund_outage"); }
    await fail(id);
    expect(await credits()).toBe(200);
  });
  it("does not settle a fresh or completed task", async () => {
    const id = (await create()).rows[0].result.draft.id;
    await db.query("select fail_weapp_draft($1,'超时',true)", [id]);
    expect(await credits()).toBe(197);
    await db.query("update weapp_drafts set status='ready',content='正文' where id=$1", [id]);
    await fail(id);
    expect(await credits()).toBe(197);
  });
  it("rejects another user's opportunity inside the transaction", async () => {
    const opp = "00000000-0000-4000-8000-000000000003";
    await db.query("insert into topic_opportunities values ($1,$2)", [opp, other]);
    await expect(db.query("select create_weapp_draft($1,'request-other','opportunity',$2,'{}'::jsonb,'wechat')", [user, opp])).rejects.toThrow("opportunity_not_found");
    expect(await credits()).toBe(200);
  });
  it("denies anonymous and authenticated RPC execution and private snapshot enumeration", async () => {
    expect((await db.query<{ allowed: boolean }>("select has_table_privilege('service_role', 'public.weapp_opportunity_shares', 'select,insert,update,delete') allowed")).rows[0].allowed).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1, 'public.create_weapp_draft(uuid,text,text,text,jsonb,text)', 'execute') allowed", [role])).rows[0].allowed).toBe(false);
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1, 'public.fail_weapp_draft(uuid,text,boolean)', 'execute') allowed", [role])).rows[0].allowed).toBe(false);
      expect((await db.query<{ allowed: boolean }>("select has_table_privilege($1, 'public.weapp_opportunity_shares', 'select') allowed", [role])).rows[0].allowed).toBe(false);
    }
  });
});
