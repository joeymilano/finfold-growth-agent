import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { sha256Hex } from "@/lib/extension/crypto";
import { issueWeappToken, verifyWeappBridgeRequest } from "@/lib/weapp/auth";

/**
 * The only token-issuance endpoint. Called exclusively by the WeChat cloud
 * function bridge, which has already performed code2session — the bridge
 * secret proves the caller, so the openid in the body is trusted from there.
 */
const bodySchema = z.object({
  openid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  unionid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).nullish(),
  nickname: z.string().trim().max(32).nullish()
});

/**
 * Recovers an openid whose auth user exists but whose identity row was lost
 * (half-failed first login, or the identity row was deleted directly). The
 * deterministic email resolves back to the user via an admin link generation —
 * the synthetic address is unreachable, so no real email is delivered; we only
 * need the user object. Returns null when recovery is not applicable.
 */
async function recoverLostIdentity(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  input: { openid: string; unionid: string | null; nickname: string | null; email: string; createErrorMessage?: string }
): Promise<{ identityId: string; userId: string } | null> {
  if (!input.createErrorMessage || !/already (registered|exists)/i.test(input.createErrorMessage)) return null;
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: input.email });
  const user = link?.user;
  if (linkError || !user) return null;
  const { data: inserted, error: insertError } = await admin
    .from("weapp_identities")
    .insert({ openid: input.openid, unionid: input.unionid, user_id: user.id, nickname: input.nickname })
    .select("id")
    .single();
  if (insertError || !inserted) {
    const { data: raced } = await admin.from("weapp_identities").select("id,user_id").eq("openid", input.openid).maybeSingle();
    return raced?.user_id === user.id ? { identityId: raced.id, userId: raced.user_id } : null;
  }
  return { identityId: inserted.id, userId: user.id };
}

export async function POST(request: Request) {
  if (!(await verifyWeappBridgeRequest(request))) {
    return NextResponse.json({ error: "bridge unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  }
  try {
    const { openid, unionid, nickname } = bodySchema.parse(await request.json());

    const { data: existing, error: identityReadError } = await admin
      .from("weapp_identities")
      .select("id, user_id, nickname, unionid")
      .eq("openid", openid)
      .maybeSingle();

    if (identityReadError) return NextResponse.json({ error: "登录服务暂不可用，请重试。" }, { status: 503 });

    let identityId: string;
    let userId: string;
    let isNew = false;

    if (existing) {
      identityId = existing.id;
      userId = existing.user_id;
      await admin
        .from("weapp_identities")
        .update({
          last_seen_at: new Date().toISOString(),
          unionid: existing.unionid ?? unionid ?? null,
          nickname: existing.nickname ?? nickname ?? null
        })
        .eq("id", identityId);
    } else {
      isNew = true;
      const email = `wa_${(await sha256Hex(openid)).slice(0, 24)}@weapp.finfold.app`;
      const password = (await sha256Hex(`${openid}:${crypto.randomUUID()}`)).slice(0, 48);
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: nickname ?? "微信用户", weapp_openid: openid }
      });
      if (createError || !created?.user) {
        // A same-email user existing without an identity row means the link
        // was lost. Recover by re-linking instead of locking this openid out
        // with a permanent 409 (the deterministic email can never be re-created).
        const recovered = await recoverLostIdentity(admin, {
          openid,
          unionid: unionid ?? null,
          nickname: nickname ?? null,
          email,
          createErrorMessage: createError?.message
        });
        if (!recovered) {
          return NextResponse.json(
            { error: createError?.message ?? "user creation failed" },
            { status: 409 }
          );
        }
        identityId = recovered.identityId;
        userId = recovered.userId;
      } else {
        userId = created.user.id;
        const { data: inserted, error: identityError } = await admin
          .from("weapp_identities")
          .insert({ openid, unionid: unionid ?? null, user_id: userId, nickname: nickname ?? null })
          .select("id")
          .single();
        if (identityError || !inserted) {
          // Preserve the recoverable auth user: a concurrent recovery may already
          // have linked it. Never delete an identity another login can own.
          const { data: raced } = await admin.from("weapp_identities").select("id,user_id").eq("openid", openid).maybeSingle();
          if (raced?.user_id === userId) {
            const { error: grantError } = await admin.rpc("grant_weapp_signup_credits", { p_user_id: userId });
            if (grantError) return NextResponse.json({ error: "登录初始化失败，请重试。" }, { status: 503 });
            const token = await issueWeappToken(admin, { identityId: raced.id, userId });
            return NextResponse.json({ token, userId, isNew: false });
          }
          throw new Error(identityError?.message ?? "identity insert failed");
        }
        identityId = inserted.id;
      }
      // Idempotent welcome grant — a replayed login never double-grants.
      // Amount is fixed inside the RPC; callers cannot influence it.
    }
    const { error: grantError } = await admin.rpc("grant_weapp_signup_credits", { p_user_id: userId });
    if (grantError) return NextResponse.json({ error: "登录初始化失败，请重试。" }, { status: 503 });

    const token = await issueWeappToken(admin, { identityId, userId });
    return NextResponse.json({ token, userId, isNew });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "session failed" },
      { status: 400 }
    );
  }
}
