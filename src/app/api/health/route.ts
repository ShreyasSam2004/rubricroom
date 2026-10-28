import { NextResponse } from "next/server";
import { getDbKind } from "@/lib/db/client";
import { providerStatus } from "@/lib/env";

export async function GET() {
  try {
    const db = await getDbKind();
    return NextResponse.json({ ok: true, db, providers: providerStatus() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
