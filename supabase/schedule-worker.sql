-- Run AFTER functions, secrets and data transfer are verified.
-- Add jigyabyte_worker_token in Dashboard > Integrations > Vault first.
-- This must match the JIGYABYTE_WORKER_TOKEN Edge Function secret.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if (select value from jigyabyte.settings where key='migration_ready') is distinct from 'true' then
    raise exception 'Finish data transfer before scheduling the worker';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name='jigyabyte_worker_token') then
    raise exception 'Configure the worker token in Vault first';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname='jigyabyte-worker';
  perform cron.schedule('jigyabyte-worker','* * * * *',$job$
    select net.http_post(
      url := 'https://fuomvvzgdhleikztdpgz.supabase.co/functions/v1/jigyabyte-worker',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name='jigyabyte_worker_token')),
      body := '{}'::jsonb, timeout_milliseconds := 120000
    ) where exists (
      select 1 from jigyabyte.jobs
      where (state='queued' and next_at <= (extract(epoch from now())*1000)::bigint)
         or (state='running' and lease_until <= (extract(epoch from now())*1000)::bigint)
    );
  $job$);
end $$;
