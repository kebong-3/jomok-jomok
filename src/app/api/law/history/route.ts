import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LawError } from '@/server/law';
import { getOrdinanceVersion, searchOrdinanceHistory, type HistoryCursors } from '@/server/ordinance-history';
import { historyYears, seoulToday } from '@/lib/ordinance-history';
export const runtime = 'nodejs';
export const maxDuration = 120;
const querySchema = z.object({ query: z.string().trim().max(120).default(''), endYear: z.coerce.number().int().min(2004), org: z.string().regex(/^\d{7}$/).optional(), sborg: z.string().regex(/^\d{7}$/).optional(), offline: z.boolean().optional(), cursors: z.record(z.string(), z.union([z.number().int().min(1).max(10000), z.null()])).optional() });
const headers = { 'Cache-Control': 'no-store' };
async function search(input: unknown) {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success || parsed.data.endYear > Number(seoulToday().slice(0, 4)) || (parsed.data.sborg && !parsed.data.org)) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: '조회 연도와 지역 코드를 확인해 주세요. 시군구 코드에는 상위 시도 코드도 필요합니다.' } }, { status: 400, headers });
  const { offline, cursors, ...query } = parsed.data;
  if (cursors) {
    const expected = historyYears(query.endYear).flatMap(year => ['current', 'history'].map(scope => `${year}:${scope}`));
    if (Object.keys(cursors).length !== expected.length || expected.some(key => !(key in cursors))) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: '이어서 조회할 목록 위치가 맞지 않습니다. 처음부터 다시 조회해 주세요.' } }, { status: 400, headers });
  }
  return NextResponse.json(await searchOrdinanceHistory(query, cursors as HistoryCursors | undefined, offline), { headers });
}
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.has('mst')) {
    const mst = url.searchParams.get('mst') || ''; const id = url.searchParams.get('id') || '';
    if (!/^\d{1,20}$/.test(mst) || !/^\d{1,20}$/.test(id)) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: '조례 번호와 공포 버전 번호를 확인해 주세요.' } }, { status: 400, headers });
    try { return NextResponse.json(await getOrdinanceVersion(id, mst, url.searchParams.get('offline') === '1'), { headers }); }
    catch (error) { return NextResponse.json({ error: { code: error instanceof LawError ? error.code : 'LAW_DOWN', message: error instanceof LawError ? error.message : '공포 버전 원문을 받지 못했습니다.' } }, { status: 502, headers }); }
  }
  return search({ query: url.searchParams.get('q') || '', endYear: url.searchParams.get('endYear') || seoulToday().slice(0, 4), org: url.searchParams.get('org') || undefined, sborg: url.searchParams.get('sborg') || undefined, offline: url.searchParams.get('offline') === '1' });
}
export async function POST(req: Request) {
  const length = Number(req.headers.get('content-length') || '0');
  if (length > 12000) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: '조회 조건이 너무 큽니다.' } }, { status: 400, headers });
  try { const raw = await req.text(); if (raw.length > 12000) throw new Error('large'); return search(JSON.parse(raw)); }
  catch { return NextResponse.json({ error: { code: 'BAD_REQUEST', message: '조회 조건을 읽을 수 없습니다.' } }, { status: 400, headers }); }
}
