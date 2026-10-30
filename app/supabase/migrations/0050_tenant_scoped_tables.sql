-- 0050_tenant_scoped_tables.sql
--
-- Enumerate the tables that carry customer data, with their RLS state.
--
-- Exists so the cross-tenant isolation test (scripts/tenant-isolation.test.mjs)
-- can discover tenant tables from the live catalog instead of a hardcoded list.
-- A hardcoded list goes stale silently: someone adds a table, forgets RLS, and
-- the test keeps passing because it never looks at the new table. That is the
-- worst failure mode available to a test whose whole job is to prove isolation.
--
-- Returns metadata only — table names and a boolean. No customer data, and it
-- cannot be used to read any. Restricted to service_role regardless, because the
-- only caller is the test harness and there is no reason for a browser session
-- to enumerate the schema.

create or replace function public.tenant_scoped_tables()
returns table(table_name text, rls_enabled boolean)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select c.relname::text, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind = 'r'
    and exists (
      select 1
      from pg_attribute a
      where a.attrelid = c.oid
        and a.attname = 'company_id'
        and a.attnum > 0
        and not a.attisdropped
    )
  order by c.relname;
$$;

revoke all on function public.tenant_scoped_tables() from public;
revoke all on function public.tenant_scoped_tables() from anon;
revoke all on function public.tenant_scoped_tables() from authenticated;
grant execute on function public.tenant_scoped_tables() to service_role;
