# Supabase schema management

This directory holds the database schema for the Puyallup River Companion as
**idempotent SQL migrations**, so the live project and a fresh local environment
can both be built from the same source of truth.

## Project

- **Project ref:** `pztcfsqifbfkjvosygcy`
- **Region:** check Supabase Dashboard → Project Settings → General
- **Postgres:** 17.x
- **Client config:** `src/services/supabase.js` (publishable/anon key)

## Migrations

| File | Purpose |
| --- | --- |
| `20260917000000_init_schema.sql` | Creates `public.catches`, the `public_catch_feed` view, and the `get_global_calibration()` RPC. Every statement is `IF NOT EXISTS` / `CREATE OR REPLACE`, so it is a no-op against the existing live database. |
| `20260917000100_normalize_rls.sql` | Replaces the five overlapping legacy RLS policies on `catches` with one canonical policy per command (select / insert / update / delete). Behaviour-preserving — see the header comment in that file for the role-by-role proof. |

The migrations were authored from the **live catalog** (introspected via
`pg_attribute`, `pg_indexes`, `pg_get_viewdef()` and `pg_get_functiondef()`), so
they describe exactly what already exists rather than an idealised schema.

## Applying migrations

> **This project has never been CLI-managed** — there is no
> `supabase_migrations.schema_migrations` table on the live database yet. The
> first `db push` creates that table and records these versions.

Because the objects already exist live and the SQL is idempotent, pushing is
safe: table/view/function creation becomes a no-op, and only the RLS
normalisation actually changes anything.

```bash
# 1. Authenticate (interactive) — or export SUPABASE_ACCESS_TOKEN.
npx supabase login

# 2. Point the CLI at the hosted project.
npx supabase link --project-ref pztcfsqifbfkjvosygcy

# 3. Apply the migrations.
npx supabase db push
```

If `db push` reports the migrations as already applied (after a future re-run),
you can re-run just the RLS step directly against the database, or reset with
`npx supabase migration repair`.

## Local development

```bash
npx supabase start          # requires Docker
npx supabase db reset       # builds a fresh local DB from these migrations
```

## Verification

After pushing, confirm the normalised policies:

```sql
select policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename = 'catches'
 order by cmd, policyname;
-- expect exactly: catches_delete_own, catches_insert_own,
--                 catches_select_own, catches_update_own
```

## Security notes

- `public_catch_feed` **must** keep `security_invoker = false` (the default). The
  view owner bypasses RLS on `catches`, which is what lets signed-out visitors
  read the Brag Board while their own private rows stay hidden.
- `get_global_calibration()` is `SECURITY DEFINER` by design: community sonar
  needs to read every angler's tackle row, which own-row RLS would hide. It
  returns only tackle/flow columns — never `angler_name`, GPS or `user_id`.
