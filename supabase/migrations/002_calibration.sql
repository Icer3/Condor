-- condor.io · predicted-vs-realized calibration dataset
-- One row per closed (or currently-open) paper position. Realised P/L captured
-- at close, predicted fields captured at open. The dataset that feeds the
-- /calibration dashboard and any future analytics (regime detection, etc.).
--
-- Replaces the previous `paper_position_calibration` table that lived in
-- SQLite (lib/db/migrations/001_calibration.sql). That migration is now
-- obsolete — the cron never wrote here, only the /api/calibration route did.

create table if not exists paper_position_calibration (
  user_id            uuid          references auth.users(id) on delete cascade not null,
  position_id        text          not null,
  strategy_id        text          not null,
  ticker             text          not null,
  opened_at          timestamptz   not null,
  closed_at          timestamptz,
  predicted_pop      real,
  predicted_pnl      real,
  predicted_maxloss  real,
  max_profit         real,
  realized_pnl       real,
  close_reason       text,
  sigma_at_entry     real,
  primary key (user_id, position_id)
);

create index if not exists idx_ppc_user_closed_at
  on paper_position_calibration (user_id, closed_at desc nulls last);

create index if not exists idx_ppc_user_strategy
  on paper_position_calibration (user_id, strategy_id);

alter table paper_position_calibration enable row level security;

create policy "users read own calibration rows"
  on paper_position_calibration for select
  using (auth.uid() = user_id);

create policy "users write own calibration rows"
  on paper_position_calibration for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
