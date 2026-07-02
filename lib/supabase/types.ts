// Hand-curated Database type. Run `supabase gen types typescript --project-id=<ID>`
// against the live project to refresh, then merge. Kept minimal here so imports
// stay type-safe without needing the CLI to be in the build chain.

export interface Database {
  public: {
    Tables: {
      paper_positions: {
        Row: {
          user_id: string;
          // JSONB column — typed as the runtime shape (PaperPosition[]) at the
          // call site. Cast through `unknown` when reading.
          positions: unknown;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          positions: unknown;
          updated_at?: string;
        };
        Update: {
          positions?: unknown;
          updated_at?: string;
        };
      };
      paper_position_calibration: {
        Row: {
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
        };
        Insert: {
          user_id: string;
          position_id: string;
          strategy_id: string;
          ticker: string;
          opened_at: string;
          closed_at?: string | null;
          predicted_pop?: number | null;
          predicted_pnl?: number | null;
          predicted_maxloss?: number | null;
          max_profit?: number | null;
          realized_pnl?: number | null;
          close_reason?: string | null;
          sigma_at_entry?: number | null;
        };
        Update: {
          closed_at?: string | null;
          predicted_pop?: number | null;
          predicted_pnl?: number | null;
          predicted_maxloss?: number | null;
          max_profit?: number | null;
          realized_pnl?: number | null;
          close_reason?: string | null;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
