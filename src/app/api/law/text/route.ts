import { NextResponse } from 'next/server';
import { getLawText, isLawKind, LawError } from '@/server/law';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = (u.searchParams.get('id') ?? '').trim();
  const kind = u.searchParams.get('kind') ?? 'law';
  const title = u.searchParams.get('title')?.trim() || undefined;
  if (!isLawKind(kind) || (!id && !title) || id.length > 100 || (title?.length ?? 0) > 200) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: '법령 종류와 id 또는 title을 확인해 주세요.' } }, { status: 400 });
  try {
    const r = await getLawText(kind, id || 'none', title, u.searchParams.get('offline') === '1');
    return NextResponse.json(r, { headers: { 'Cache-Control': r.meta.via === 'snapshot' ? 'no-store' : 'public, s-maxage=300', 'X-Law-Source': r.meta.via } });
  } catch (e) {
    return NextResponse.json({ error: { code: e instanceof LawError ? e.code : 'LAW_DOWN', message: e instanceof LawError ? e.message : '법령 원문을 조회하지 못했습니다.' } }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
