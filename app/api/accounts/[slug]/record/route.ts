import { NextResponse } from "next/server";
import { PAGE_RECORD_VERSION, pageRecordFor } from "@/lib/engine/page-record";
import { getStore } from "@/lib/store";
import { pageTokenFor, parsePageParam } from "@/lib/util";

export const dynamic = "force-dynamic";

/**
 * The account's prospect-page record in the cartage-pages accounts/*.json
 * schema. Write it to cartage-pages/accounts/{slug}.json to build the same
 * page statically with the Astro project. Accepts {slug} or {slug}-{token}.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: param } = await params;
  const store = getStore();
  const { slug, token } = parsePageParam(param);
  let account = await store.getAccountBySlug(slug);
  if (!account && token) account = await store.getAccountBySlug(param);
  if (!account) return NextResponse.json({ ok: false, error: `no account with slug "${param}"` }, { status: 404 });
  if (token && account.slug === slug && token !== pageTokenFor(account.id)) {
    return NextResponse.json({ ok: false, error: "token does not match this account" }, { status: 404 });
  }
  const record = await pageRecordFor(account);
  return NextResponse.json({ record, version: PAGE_RECORD_VERSION, file: `accounts/${record.slug}.json` });
}
