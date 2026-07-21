-- =====================================================================
-- Read-only share links for a betting system.
--
-- A non-null share_token makes the system viewable at /share/<token>
-- with no authentication. Revoking simply nulls the column, which
-- immediately 404s the public page. The token is a random UUID so it
-- isn't guessable from the system id.
--
-- RLS on `systems` stays as-is (enabled, no policies → service_role
-- only). The public /share page reads via the server-side admin
-- client after resolving the token, so no anon grant is needed.
-- =====================================================================

alter table public.systems
  add column if not exists share_token text unique;

create index if not exists systems_share_token_idx
  on public.systems(share_token)
  where share_token is not null;
