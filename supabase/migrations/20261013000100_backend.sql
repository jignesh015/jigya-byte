-- Private backend storage. No phone access via the Supabase Data API.
begin;
create schema if not exists jigyabyte;
revoke all on schema jigyabyte from public, anon, authenticated;

create table jigyabyte.cards (
  seq bigint generated always as identity,
  id text primary key, hash text unique not null, fingerprint text unique not null, body text not null
);
create table jigyabyte.devices (
  id text primary key, version bigint not null, snapshot text not null, refilling integer not null default 0
);
create table jigyabyte.history (
  device_id text not null, event_id text not null, body text not null, primary key(device_id,event_id)
);
create table jigyabyte.deliveries (
  id text primary key, device_id text not null, version bigint not null, cards text not null,
  state text not null, result text
);
create unique index one_pending_delivery on jigyabyte.deliveries(device_id) where state='pending';
create table jigyabyte.jobs (
  seq bigint generated always as identity,
  id text primary key, device_id text not null, count integer not null, state text not null,
  attempts integer not null default 0, next_at bigint not null default 0, error text,
  provider_index integer not null default 0, diagnostics text, attempt_log text not null default '[]',
  lease_until bigint not null default 0, claim_token text
);
create unique index one_active_job on jigyabyte.jobs(device_id) where state in ('queued','running','uncertain');
create table jigyabyte.usage (
  day text primary key, requests integer not null, tokens bigint not null, cost double precision not null
);
create table jigyabyte.source_cache (key text primary key, fetched_at bigint not null, body text not null);
create table jigyabyte.topic_generation (topic text primary key, count integer not null);
create table jigyabyte.source_usage (id text primary key);
create table jigyabyte.settings (key text primary key, value text not null);
-- A fresh deployment cannot spend until the local usage ledger has been transferred.
insert into jigyabyte.settings values ('migration_ready','false');

do $$
declare t text;
begin
  foreach t in array array['cards','devices','history','deliveries','jobs','usage','source_cache','topic_generation','source_usage','settings'] loop
    execute format('alter table jigyabyte.%I enable row level security',t);
    execute format('revoke all on jigyabyte.%I from public, anon, authenticated',t);
  end loop;
end $$;
commit;
