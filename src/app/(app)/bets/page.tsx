import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type {
  Capper,
  CapperBetEntry,
  JournalDayEntry,
} from "@/lib/types";
import { fmtMoney, pctClass, todayISO } from "@/lib/utils";
import { isSport, type Sport } from "@/lib/sports";
import DailySummary from "@/components/DailySummary";
import SportIcon from "@/components/SportIcon";
import ExportButton from "@/components/ExportButton";

/**
 * Bets → Daily Bet Summary
 *
 * Daily roll-up of every bet-level entry recorded on a single date,
 * across every capper in the active system. Acts as the read-side
 * counterpart to the per-capper bet editor: whatever a user types into
 * a bet-level entry on /cappers/[id] flows here automatically, and
 * later edits stay in sync because both views read from the same
 * capper_bet_entries source on each render (the page is force-dynamic
 * and bet mutation actions revalidatePath("/bets") so the Next.js
 * router cache invalidates too).
 *
 * The selected date is driven by the shared `?date=` URL param — the
 * SAME param the dashboard's date picker writes to, so users learn one
 * filter and sharing a URL between /dashboard and /bets keeps both on
 * the same day.
 *
 * Layout:
 *   1. Date selector (same GET-form pattern as the dashboard)
 *   2. DailySummary panel — shared component, byte-for-byte identical
 *      numbers as the dashboard for the same date
 *   3. Daily Bet Summary table, grouped by result Win → Loss → Void →
 *      Pending; within each group sorted by created_at ASC so the
 *      earliest-submitted bets float to the top of their group.
 *
 * No DB / schema changes. Pure read-side composition.
 */

export const dynamic = "force-dynamic";

// Result group ordering required by the product spec.
const RESULT_ORDER: Record<string, number> = {
  win: 0,
  loss: 1,
  void: 2,
  pending: 3,
};

// Display config so the result pill in this table matches the per-capper
// bet editor's pill style (pill-good / pill-bad / pill-mute / pill-pending).
const RESULT_PILL: Record<string, string> = {
  win: "pill-good",
  loss: "pill-bad",
  void: "pill-mute",
  pending: "pill-pending",
};

interface BetRow extends CapperBetEntry {
  /** Joined client-side from the system's cappers list. */
  created_at?: string;
}

export default async function BetsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const sysId = ctx.activeSystemId;
  if (!sysId) redirect("/systems?first=1");
  const supabase = createAdminClient();

  // Default-date logic mirrors the dashboard exactly so the two pages
  // land on the same day when neither has an explicit ?date= override.
  const { data: latestJournal } = await supabase
    .from("journal_day_entries")
    .select("date")
    .eq("system_id", sysId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const focusDate =
    sp.date || latestJournal?.date || todayISO();

  // Single round-trip: the journal row for the Daily Summary panel, the
  // bets recorded on that date, and the capper roster for name lookup.
  const [
    { data: journalRow },
    { data: betRows },
    { data: capperRows },
  ] = await Promise.all([
    supabase
      .from("journal_day_entries")
      .select("*")
      .eq("system_id", sysId)
      .eq("date", focusDate)
      .maybeSingle(),
    supabase
      .from("capper_bet_entries")
      .select("*, created_at")
      .eq("system_id", sysId)
      .eq("date", focusDate)
      .order("created_at"),
    supabase
      .from("cappers")
      .select("id, name")
      .eq("system_id", sysId),
  ]);

  const dayJournal = (journalRow ?? null) as JournalDayEntry | null;
  const bets = (betRows ?? []) as BetRow[];

  const capperNameById = new Map<string, string>();
  for (const c of (capperRows ?? []) as Pick<Capper, "id" | "name">[]) {
    capperNameById.set(c.id, c.name);
  }

  // Group by result in the required Win → Loss → Void → Pending order,
  // then by created_at ASC inside each group. localeCompare on the ISO
  // timestamp string is a stable chronological sort.
  const sortedBets = [...bets].sort((a, b) => {
    const ra = RESULT_ORDER[a.bet_result] ?? 99;
    const rb = RESULT_ORDER[b.bet_result] ?? 99;
    if (ra !== rb) return ra - rb;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6" id="bets-root">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
            Bets
          </div>
          <h1 className="text-xl md:text-2xl font-bold">Daily Bet Summary</h1>
          <p className="text-ink-dim text-sm">
            Every bet-level entry recorded on{" "}
            <span className="text-ink font-mono">{focusDate}</span>, rolled up
            across all cappers and grouped by result. Date is shared with the{" "}
            <Link href={`/dashboard?date=${focusDate}`} className="text-accent hover:underline">
              Dashboard
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Same date control as the dashboard — same ?date= param, same
              GET-form pattern — so the user doesn't learn a second filter
              and bookmarks/share URLs work identically on both pages. */}
          <form className="flex gap-2 items-center">
            <input
              type="date"
              name="date"
              defaultValue={focusDate}
              className="input flex-1"
            />
            <button className="btn-ghost shrink-0" type="submit">
              Set
            </button>
          </form>
          <ExportButton
            targetId="bets-root"
            filename={`open-bets-${focusDate}.png`}
          />
        </div>
      </header>

      <DailySummary focusDate={focusDate} dayJournal={dayJournal} />

      <div className="panel p-0">
        <div className="table-wrap">
          <table className="tbl font-mono">
            <thead>
              <tr>
                <th>Capper</th>
                <th>Sport</th>
                <th className="text-right">Wager</th>
                <th className="text-right">Odds</th>
                <th>Result</th>
                <th className="text-right">$ PNL</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {sortedBets.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center text-ink-dim py-6"
                  >
                    No bets recorded for this date.
                  </td>
                </tr>
              )}
              {sortedBets.map((b) => {
                const pill = RESULT_PILL[b.bet_result] ?? "pill-mute";
                const isPending = b.bet_result === "pending";
                const sportTag = isSport(b.sport) ? (b.sport as Sport) : null;
                return (
                  <tr key={b.id} className={isPending ? "bg-pending/5" : ""}>
                    <td>
                      <Link
                        href={`/cappers/${b.capper_id}`}
                        className="hover:text-accent"
                      >
                        {capperNameById.get(b.capper_id) ?? "—"}
                      </Link>
                    </td>
                    <td>
                      {sportTag ? (
                        <span className="inline-flex items-center gap-1.5 text-ink">
                          <SportIcon sport={sportTag} size={13} />
                          <span className="text-xs">{sportTag}</span>
                        </span>
                      ) : (
                        <span className="text-ink-dim text-xs">—</span>
                      )}
                    </td>
                    <td className="text-right">{fmtMoney(b.wager_amount)}</td>
                    <td className="text-right">{b.odds ?? "—"}</td>
                    <td>
                      <span className={pill}>{b.bet_result}</span>
                    </td>
                    <td
                      className={
                        isPending
                          ? "text-right text-pending italic"
                          : `text-right ${pctClass(b.amount_pnl)}`
                      }
                    >
                      {isPending
                        ? "— awaiting result"
                        : fmtMoney(b.amount_pnl, { sign: true })}
                    </td>
                    <td className="text-ink-dim">{b.notes ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
