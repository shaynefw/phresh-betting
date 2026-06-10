/**
 * POST /api/import-backup
 *
 * JSON body:
 *   { systemId: string, payload: BackupPayload }
 *
 * Replaces the old `importBackup` Server Action — Route Handlers don't
 * encode the request via React Flight, so backups with thousands of
 * bets/days don't trip the "Maximum array nesting exceeded" safety.
 */
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runImportBackup, type BackupPayload } from "@/lib/import-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ownsSystem(systemId: string): Promise<boolean> {
  const userId = await getUserId();
  if (!userId) return false;
  const sb = createAdminClient();
  const { data } = await sb
    .from("systems")
    .select("id")
    .eq("id", systemId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function POST(req: Request) {
  let body: { systemId?: string; payload?: BackupPayload };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const systemId = body?.systemId;
  const payload = body?.payload;
  if (!systemId || typeof systemId !== "string") {
    return NextResponse.json({ error: "Missing systemId" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  if (!(await ownsSystem(systemId))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const result = await runImportBackup(systemId, payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, summary: result.summary });
}
