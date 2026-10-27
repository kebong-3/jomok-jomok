import { NextResponse } from 'next/server';
import { searchLaw, isLawKind } from '@/server/law';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') ?? '').trim();
  const kind = u.searchParams.get('kind') ?? 'law';
  const org = u.searchParams.get('org')?.trim();
  if (!q || q.length > 200 || !isLawKind(kind) || (org && !/^\d{2,10}$/.test(org))) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: '검색어·법령 종류를 확인해 주세요. 기관 필터는 공식 기관코드로 입력합니다.' } }, { status: 400 });
  const r = await searchLaw(kind, q, org, u.searchParams.get('offline') === '1');
  return NextResponse.json(r, { headers: { 'Cache-Control': r.meta.via === 'snapshot' ? 'no-store' : 'public, s-maxage=300', 'X-Law-Source': r.meta.via } });
}
