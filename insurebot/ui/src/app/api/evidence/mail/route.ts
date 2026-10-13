import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { handle, requireSession } from "@/lib/guard";

export const dynamic = "force-dynamic";

type MailpitList = { total: number; messages: { ID: string; Created: string; To: { Address: string }[]; Subject: string; Snippet: string }[] };

export const GET = handle(async () => {
  await requireSession();
  const res = await fetch(`${cfg().mailpitUrl}/api/v1/messages?limit=500`);
  const list = (await res.json()) as MailpitList;
  const byRecipient: Record<string, number> = {};
  for (const m of list.messages) for (const t of m.To) byRecipient[t.Address] = (byRecipient[t.Address] ?? 0) + 1;
  return NextResponse.json({
    total: list.total,
    byRecipient,
    latest: list.messages.slice(0, 15).map((m) => ({ id: m.ID, at: m.Created, to: m.To.map((t) => t.Address), subject: m.Subject, snippet: m.Snippet })),
  });
});
