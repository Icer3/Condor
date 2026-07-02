// Supabase-backed repo for the calibration rows. Replaces the previous
// better-sqlite3 implementation (now deleted). All functions take a Supabase
// client AND the authenticated user.id — RLS enforces the scope server-side,
// we pass it explicitly here as a sanity belt-and-suspenders.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CalibrationRow {
  user_id: string;
  position_id: string;
  strategy_id: string;
  ticker: string;
  opened_at: string;
  closed_at: string | null;
  predicted_pop: number | null;
  predicted_pnl: number | null;
  predicted_maxloss: number | null;
  max_profit: number | null;
  realized_pnl: number | null;
  close_reason: string | null;
  sigma_at_entry: number | null;
}

export interface CalUpsertInput {
  position_id: string;
  strategy_id: string;
  ticker: string;
  opened_at: string;
  predicted_pop?: number | null;
  predicted_pnl?: number | null;
  predicted_maxloss?: number | null;
  max_profit?: number | null;
  sigma_at_entry?: number | null;
}

export interface CalCloseInput {
  position_id: string;
  realized_pnl: number;
  closed_at: string;
  close_reason?: string | null;
}

export async function upsertPrediction(
  db: SupabaseClient,
  userId: string,
  input: CalUpsertInput,
): Promise<void> {
  const { error } = await db.from('paper_position_calibration').upsert(
    {
      user_id: userId,
      position_id: input.position_id,
      strategy_id: input.strategy_id,
      ticker: input.ticker,
      opened_at: input.opened_at,
      predicted_pop: input.predicted_pop ?? null,
      predicted_pnl: input.predicted_pnl ?? null,
      predicted_maxloss: input.predicted_maxloss ?? null,
      max_profit: input.max_profit ?? null,
      sigma_at_entry: input.sigma_at_entry ?? null,
      closed_at: null,
      realized_pnl: null,
      close_reason: null,
    },
    { onConflict: 'user_id,position_id' },
  );
  if (error) throw new Error(`upsertPrediction: ${error.message}`);
}

export async function recordClose(
  db: SupabaseClient,
  userId: string,
  input: CalCloseInput,
): Promise<void> {
  const { error } = await db
    .from('paper_position_calibration')
    .update({
      closed_at: input.closed_at,
      realized_pnl: input.realized_pnl,
      close_reason: input.close_reason ?? null,
    })
    .eq('user_id', userId)
    .eq('position_id', input.position_id);
  if (error) throw new Error(`recordClose: ${error.message}`);
}

export async function readAll(
  db: SupabaseClient,
  userId: string,
): Promise<CalibrationRow[]> {
  const { data, error } = await db
    .from('paper_position_calibration')
    .select('*')
    .eq('user_id', userId)
    .order('opened_at', { ascending: false });
  if (error) throw new Error(`readAll: ${error.message}`);
  return (data ?? []) as CalibrationRow[];
}

export async function purgeDevice(
  db: SupabaseClient,
  userId: string,
): Promise<number> {
  const { error, count } = await db
    .from('paper_position_calibration')
    .delete({ count: 'exact' })
    .eq('user_id', userId);
  if (error) throw new Error(`purgeDevice: ${error.message}`);
  return count ?? 0;
}
