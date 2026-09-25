create table public.scan_rate_limits (
 subject text not null check (subject ~ '^[a-f0-9]{64}$'),
 action text not null check (action in ('run','research','generate-prompts','keywords')),
 used integer not null check (used >= 1),
 reset_at timestamptz not null,
 primary key (subject, action)
);
alter table public.scan_rate_limits enable row level security;
revoke all on public.scan_rate_limits from public, anon, authenticated;
grant select, insert, update on public.scan_rate_limits to service_role;

create function public.consume_scan_limit(p_subject text, p_action text)
returns table(allowed boolean, retry_after integer)
language plpgsql security invoker set search_path = '' as $$
declare
 v_limit integer;
 v_used integer;
 v_reset timestamptz;
 v_now timestamptz := clock_timestamp();
begin
 v_limit := case p_action when 'research' then 10 when 'run' then 3 when 'generate-prompts' then 3 when 'keywords' then 3 else null end;
 if v_limit is null or p_subject is null or p_subject !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid limit request';
 end if;
 insert into public.scan_rate_limits as q(subject, action, used, reset_at)
 values(p_subject, p_action, 1, v_now + interval '24 hours')
 on conflict(subject, action) do update
 set used = case when q.reset_at <= v_now then 1 else q.used + 1 end,
 reset_at = case when q.reset_at <= v_now then v_now + interval '24 hours' else q.reset_at end
 where q.reset_at <= v_now or q.used < v_limit
 returning used, reset_at into v_used, v_reset;
 if found then return query select true, 0;
 else
  select q.reset_at into v_reset from public.scan_rate_limits q where q.subject=p_subject and q.action=p_action;
  return query select false, greatest(1, ceil(extract(epoch from v_reset-v_now))::integer);
 end if;
end;
$$;
revoke all on function public.consume_scan_limit(text,text) from public, anon, authenticated;
grant execute on function public.consume_scan_limit(text,text) to service_role;
