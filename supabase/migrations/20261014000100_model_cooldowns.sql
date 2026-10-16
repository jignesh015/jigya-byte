begin;
create table if not exists jigyabyte.model_cooldowns (
  provider text not null, model text not null, failed_at bigint not null, reason text not null,
  primary key(provider,model)
);
alter table jigyabyte.model_cooldowns enable row level security;
revoke all on jigyabyte.model_cooldowns from public, anon, authenticated;
commit;
