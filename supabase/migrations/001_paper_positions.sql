-- condor.io · paper-trade position store
-- One row per user: their full `PaperPosition[]` lives in a single JSONB column.
-- Server is the source of truth (no localStorage). User signs in via Supabase Auth,
-- JWT carries through Next.js middleware, RLS scopes reads/writes to auth.uid().
--
-- WHY JSONB (not normalised legs in their own table): the schema for legs/strategy
-- is fluid (designed for future custom-leg builder, multis, etc.). JSONB lets the
-- shape evolve without DDL. Calibration rows are normalised in 002 because
-- they need cross-user aggregations and indexed columns for /calibration dashboard.

create table if not exists paper_positions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  positions  jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table paper_positions enable row level security;

create policy "users read own paper positions"
  on paper_positions for select
  using (auth.uid() = user_id);

create policy "users write own paper positions"
  on paper_positions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at trigger so the dashboard / listings can sort by recency cheaply.
create or replace function trg_set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_paper_positions_updated_at on paper_positions;
create trigger trg_paper_positions_updated_at
  before update on paper_positions
  for each row execute function trg_set_updated_at();
