-- Deploy before the WeApp API release. Service-role-only transaction boundaries.
alter table public.weapp_identities add column if not exists preferred_platform text
  check (preferred_platform in ('wechat','xiaohongshu','moments'));
alter table public.weapp_drafts add column if not exists request_id text;
alter table public.weapp_drafts add column if not exists started_at timestamptz;
create unique index if not exists weapp_drafts_request on public.weapp_drafts(user_id, request_id);
create index if not exists weapp_drafts_pending on public.weapp_drafts(created_at) where status='pending';

create or replace function public.create_weapp_draft(
  p_user_id uuid, p_request_id text, p_source text, p_opportunity_id text,
  p_topic jsonb, p_platform text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_row public.weapp_drafts;
  v_available integer;
  v_cost constant integer := 3;
begin
  -- Serialize idempotency checks; lock credit batches before reserve_credits'
  -- availability check so its legacy under-application path cannot consume funds.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 124));
  select * into v_row from public.weapp_drafts where user_id=p_user_id and request_id=p_request_id;
  if found then
    if v_row.topic <> p_topic or v_row.platform <> p_platform or v_row.source <> p_source
       or v_row.opportunity_id is distinct from p_opportunity_id then
      raise exception 'request_id_conflict';
    end if;
    return jsonb_build_object('draft',to_jsonb(v_row),'available',public.get_available_credits(p_user_id),'created',false);
  end if;
  if p_request_id is null or length(p_request_id) < 8 or length(p_request_id)>100 then
    raise exception 'invalid_request_id';
  end if;
  if p_source='opportunity' and not exists (
    select 1 from public.topic_opportunities where id::text=p_opportunity_id and user_id=p_user_id
  ) then raise exception 'opportunity_not_found'; end if;
  perform id from public.credit_balances where user_id=p_user_id order by expires_at asc nulls last, created_at asc for update;
  v_available := public.reserve_credits(p_user_id,v_cost,'singlePlatformCopy','weapp',jsonb_build_object('requestId',p_request_id));
  if v_available < 0 then raise exception 'insufficient_credits'; end if;
  insert into public.weapp_drafts(user_id,request_id,source,opportunity_id,topic,platform,credits_charged)
    values(p_user_id,p_request_id,p_source,p_opportunity_id,p_topic,p_platform,v_cost) returning * into v_row;
  return jsonb_build_object('draft',to_jsonb(v_row),'available',v_available,'created',true);
end; $$;

create or replace function public.fail_weapp_draft(p_id uuid,p_reason text,p_stale_only boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.weapp_drafts;
begin
  select * into v_row from public.weapp_drafts where id=p_id for update;
  if not found then return null; end if;
  if v_row.status <> 'pending' or (p_stale_only and v_row.created_at>now()-interval '4 minutes') then
    return to_jsonb(v_row);
  end if;
  -- A failure at either write rolls back both. Concurrent failures refund once.
  perform public.refund_credits(v_row.user_id,v_row.credits_charged,'refund',jsonb_build_object('weappDraftId',v_row.id));
  update public.weapp_drafts set status='failed',error=left(p_reason,500),credits_charged=0,finished_at=now()
    where id=p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create table if not exists public.weapp_opportunity_shares (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{22}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(user_id,opportunity_id)
);
alter table public.weapp_opportunity_shares enable row level security;
revoke all on public.weapp_opportunity_shares from anon,authenticated;
grant select,insert,update,delete on public.weapp_opportunity_shares to service_role;
revoke execute on function public.create_weapp_draft(uuid,text,text,text,jsonb,text) from public,anon,authenticated;
revoke execute on function public.fail_weapp_draft(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.create_weapp_draft(uuid,text,text,text,jsonb,text) to service_role;
grant execute on function public.fail_weapp_draft(uuid,text,boolean) to service_role;

grant execute on function public.grant_weapp_signup_credits(uuid) to service_role;
