// Supabase-backed repo for paper-trade positions. The server is the source of
// truth now (no more `.data/positions.json` filesystem file). One row per user.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaperPosition } from '@/lib/paperTrading';

export async function loadPositions(
  db: SupabaseClient,
  userId: string,
): Promise<PaperPosition[]> {
  const { data, error } = await db
    .from('paper_positions')
    .select('positions')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`loadPositions: ${error.message}`);
  const raw = (data?.positions as unknown) ?? null;
  if (!Array.isArray(raw)) return [];
  return raw as PaperPosition[];
}

export async function savePositions(
  db: SupabaseClient,
  userId: string,
  positions: PaperPosition[],
): Promise<void> {
  const { error } = await db.from('paper_positions').upsert(
    { user_id: userId, positions: positions as unknown as object },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`savePositions: ${error.message}`);
}

export async function deletePositions(
  db: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await db
    .from('paper_positions')
    .delete()
    .eq('user_id', userId);
  if (error) throw new Error(`deletePositions: ${error.message}`);
}
