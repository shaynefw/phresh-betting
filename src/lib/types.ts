export type UUID = string;

export type StreakType = "green" | "red" | "neutral_hold";
export type EntryMode = "daily_totals" | "bet_level";
export type BetResult = "win" | "loss" | "void";
export type Phase = "heater" | "lukewarm" | "cold";
export type Checklist = "started" | "complete";

export interface System {
  id: UUID;
  user_id: UUID;
  name: string;
  description: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScalingLogEntry {
  id: UUID;
  system_id: UUID;
  effective_date: string;
  starting_units_threshold: number | null;
  ending_units_threshold: number | null;
  unit_size_dollars: number;
  bankroll: number | null;
  notes: string | null;
  created_at: string;
}

export interface Capper {
  id: UUID;
  system_id: UUID;
  name: string;
  base_system_risk_units: number;
  is_active: boolean;
  is_archived: boolean;
  current_phase: Phase;
  checklist_status: Checklist;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapperDayEntry {
  id: UUID;
  capper_id: UUID;
  system_id: UUID;
  date: string;
  entry_mode: EntryMode;
  wager_total: number;
  bet_count: number;
  daily_amount_pnl: number;
  wins: number;
  losses: number;
  unit_size_used: number | null;
  daily_units_pnl: number;
  daily_roi_percent: number;
  cumulative_amount_pnl: number;
  cumulative_units_pnl: number;
  running_roi_percent: number;
  win_rate_percent: number;
  record_wins: number;
  record_losses: number;
  current_streak_value: number;
  current_streak_type: StreakType;
  max_win_streak: number;
  max_loss_streak: number;
  is_complete: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapperBetEntry {
  id: UUID;
  capper_day_entry_id: UUID;
  capper_id: UUID;
  system_id: UUID;
  date: string;
  wager_amount: number;
  odds: number | null;
  bet_result: BetResult;
  amount_pnl: number;
  units_risk_multiplier: number | null;
  notes: string | null;
}

export interface JournalDayEntry {
  id: UUID;
  system_id: UUID;
  date: string;
  total_wager: number;
  total_bets: number;
  total_system_risk_cumulative: number;
  daily_amount_pnl: number;
  cumulative_amount_pnl: number;
  daily_units_pnl: number;
  cumulative_units_pnl: number;
  daily_roi_percent: number;
  running_roi_percent: number;
  wins: number;
  losses: number;
  win_rate_percent: number;
  record_wins: number;
  record_losses: number;
  green_day_count: number;
  red_day_count: number;
  green_day_roi_cumulative: number;
  red_day_roi_cumulative: number;
  green_day_avg_roi: number;
  red_day_avg_roi: number;
  green_day_probability: number;
  current_streak_value: number;
  current_streak_type: StreakType;
  max_win_streak: number;
  max_loss_streak: number;
  unit_size_used: number | null;
}

export interface CapperBaseline {
  capper_id: UUID;
  system_id: UUID;
  total_betting_days: number;
  total_bets: number;
  total_risk: number;
  cumulative_amount_pnl: number;
  cumulative_units_pnl: number;
  wins: number;
  losses: number;
  green_day_count: number;
  red_day_count: number;
  green_day_roi_cumulative: number;
  red_day_roi_cumulative: number;
  running_roi_percent: number;
  win_rate_percent: number;
  green_day_avg_roi: number;
  red_day_avg_roi: number;
  green_day_probability: number;
  current_streak_value: number;
  current_streak_type: StreakType;
  max_win_streak: number;
  max_loss_streak: number;
  notes: string | null;
}

export interface SystemBaseline {
  system_id: UUID;
  total_betting_days: number;
  total_bets: number;
  total_risk: number;
  cumulative_amount_pnl: number;
  cumulative_units_pnl: number;
  wins: number;
  losses: number;
  green_day_count: number;
  red_day_count: number;
  green_day_roi_cumulative: number;
  red_day_roi_cumulative: number;
  running_roi_percent: number;
  win_rate_percent: number;
  green_day_avg_roi: number;
  red_day_avg_roi: number;
  green_day_probability: number;
  max_win_streak: number;
  max_loss_streak: number;
  notes: string | null;
}

export interface ScalingState {
  currentUnitSize: number;
  bandStartUnits: number;
  unitsAboveBand: number;
  scaleUpAt: number;
  scaleDownAt: number;
  scaleUpProgressPct: number;
  pendingNextSize?: number;
  pendingDirection?: "up" | "down";
}
