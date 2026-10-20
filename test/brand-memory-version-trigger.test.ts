// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Real SQL for migration 127: only the user's own edits create a version.
const user = "00000000-0000-4000-8000-000000000001";
let db: PGlite;
const sql = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8");

async function versions() {
  return (await db.query<{ n: number }>("select count(*)::int n from brand_memory_versions where user_id=$1", [user])).rows[0].n;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated; create role service_role;
    create table public.brand_brains (
      user_id uuid primary key references auth.users(id) on delete cascade,
      brand_name text not null default '',
      approved_examples text[] not null default '{}',
      learned_style text[] not null default '{}',
      learned_negative text[] not null default '{}',
      performance_rules text[] not null default '{}',
      visual_identity jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now());`);
  await db.exec(sql("070_brand_memory_versions.sql"));
  await db.exec(sql("127_brand_memory_versions_user_edits.sql"));
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("truncate auth.users cascade");
  await db.query("insert into auth.users values($1)", [user]);
  await db.query(
    `insert into brand_brains (user_id, brand_name, visual_identity)
     values ($1, 'Finfold', '{"palette":["#111"],"learnedPreferences":[]}')`, [user]
  );
});

describe("brand memory version trigger (migration 127)", () => {
  it("records the first save and every user-authored change", async () => {
    expect(await versions()).toBe(1);
    await db.query("update brand_brains set brand_name='Finfold 智能体', updated_at=now() where user_id=$1", [user]);
    await db.query(`update brand_brains set visual_identity = jsonb_set(visual_identity, '{palette}', '["#222"]') where user_id=$1`, [user]);
    expect(await versions()).toBe(3);
  });

  it("skips writes that only touch system-learned fields", async () => {
    await db.query(
      `update brand_brains set learned_style = array['短段落'], performance_rules = array['数字开头'],
         approved_examples = array['范文'], updated_at = now(),
         visual_identity = jsonb_set(visual_identity, '{learnedPreferences}', '[{"key":"warm"}]')
       where user_id=$1`, [user]
    );
    expect(await versions()).toBe(1);
  });

  it("keeps the newest 50 versions per user", async () => {
    for (let i = 0; i < 55; i += 1) {
      await db.query("update brand_brains set brand_name=$2 where user_id=$1", [user, `Finfold ${i}`]);
    }
    expect(await versions()).toBe(50);
    const { rows } = await db.query<{ name: string }>(
      "select snapshot->>'brand_name' as name from brand_memory_versions where user_id=$1 order by created_at desc, id desc limit 1", [user]
    );
    expect(rows[0].name).toBe("Finfold 54");
  }, 30_000);
});
