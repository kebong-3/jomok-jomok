import { sha256, type Evidence } from './project';
import { loadSettings } from './settings';

export interface LawDocResp {
  doc: { id: string; title: string; kind?: 'law' | 'admrul' | 'ordin'; url: string; effectiveAt?: string; articles: { label: string; title: string; text: string }[] };
  meta: { via: 'live' | 'relay' | 'snapshot'; fetchedAt: string; snapshotDate?: string; note?: string; partial?: boolean };
}

export async function fetchLawByTitle(title: string): Promise<LawDocResp | undefined> {
  const s = loadSettings();
  const res = await fetch(`/api/law/text?kind=law&title=${encodeURIComponent(title)}${s.forceLawOffline ? '&offline=1' : ''}`, { signal: AbortSignal.timeout(25000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? '법령 원문 조회에 실패했습니다');
  const r = data as LawDocResp;
  const normalize = (v: string) => v.replace(/[\s「」]/g, '');
  if (!r.doc?.title || normalize(r.doc.title) !== normalize(title) || !Array.isArray(r.doc.articles) || !r.doc.articles.length || !['live', 'relay', 'snapshot'].includes(r.meta?.via)) throw new Error('요청한 법령의 원문 구조를 확인하지 못했습니다');
  const effective = (r.doc.effectiveAt ?? '').replace(/-/g, '');
  if (/^\d{8}$/.test(effective) && effective > new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '')) throw new Error('시행예정 법령은 현행 근거로 사용하지 않습니다');
  return r;
}

export function lawNamesIn(text: string): string[] {
  return [...new Set([...text.matchAll(/「([^」]+)」/g)].map((m) => m[1]))];
}

const STOP = new Set(['경우', '규정', '조항', '해주세요', '주세요', '새로', '넣고', '만들고', '삭제', '있는', '하는', '그리고', '에서', '으로', '한다']);
function tokens(s: string): string[] {
  return s.replace(/[^가-힣0-9a-zA-Z\s]/g, ' ').split(/\s+/).map((w) => w.replace(/(을|를|이|가|은|는|에|의|로|으로|과|와|도|만|까지|부터)$/, '')).filter((w) => w.length >= 2 && !STOP.has(w));
}

/** 상위 법령 원문 → 근거 목록(EV-L-n). 규정이 직접 인용한 조문 + 의도와 관련된 조문 */
export async function gatherEvidence(ruleText: string, intent: string, extraLaws: string[] = []): Promise<{ evidence: Evidence[]; vias: string[]; notes: string[] }> {
  const requested = [...new Set([...extraLaws.flatMap((s) => lawNamesIn(s).length ? lawNamesIn(s) : [s.replace(/\s*제\s*\d+\s*조[\s\S]*$/, '').trim()]).filter(Boolean), ...lawNamesIn(ruleText)])];
  const names = requested.slice(0, 3);
  const evidence: Evidence[] = [];
  const vias: string[] = [];
  const notes: string[] = requested.length > 3 ? ['근거 법령은 처음 3개를 조회했습니다. 나머지 법령은 별도 확인이 필요합니다.'] : [];
  const want = tokens(intent);
  let n = 1;
  for (const name of names) {
    let r: LawDocResp | undefined;
    try { r = await fetchLawByTitle(name); } catch (e) { notes.push(`「${name}」: ${(e as Error).message}`); continue; }
    if (!r) {
      notes.push(`「${name}」 원문을 찾지 못했습니다`);
      continue;
    }
    vias.push(r.meta.via);
    if (r.meta.note) notes.push(r.meta.note);
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cited = new Set([...`${ruleText}\n${extraLaws.join('\n')}`.matchAll(new RegExp(`(?:「${escapedName}」|(?:^|\\s)${escapedName})\\s*(제\\s*\\d+\\s*조(?:\\s*의\\s*\\d+)?)`, 'g'))].map((m) => m[1].replace(/\s/g, '')));
    for (const label of cited) if (!r.doc.articles.some((a) => a.label.replace(/\s/g, '') === label)) notes.push(`「${name}」 ${label}는 조회된 원문에서 확인하지 못했습니다.`);
    if (cited.size > 3) notes.push(`「${name}」의 직접 인용 조항이 3개를 초과합니다. 이 작업에는 최대 3개를 연결하므로 나머지 조항은 별도 확인하세요.`);
    const scored = r.doc.articles
      .filter((a) => a.text && !/^삭제/.test(a.text))
      .map((a) => {
        const hay = `${a.title} ${a.text}`;
        const score = want.reduce((s, w) => s + (hay.includes(w) ? (a.title.includes(w) ? 3 : 1) : 0), 0) + (cited.has(a.label.replace(/\s/g, '')) ? 1000 : 0);
        return { a, score };
      })
      .filter((x) => x.score >= 2)
      .sort((x, y) => y.score - x.score)
      .slice(0, 3)
      .sort((x, y) => r.doc.articles.indexOf(x.a) - r.doc.articles.indexOf(y.a));
    if (!scored.length) notes.push(`「${name}」에서 요청과 관련된 조문 후보를 찾지 못했습니다.`);
    for (const { a } of scored) {
      evidence.push({
        id: `EV-L-${n++}`,
        kind: 'law',
        label: `「${r.doc.title}」 ${a.label}${a.title ? `(${a.title})` : ''}`,
        text: a.text,
        url: `https://www.law.go.kr/법령/${encodeURIComponent(r.doc.title.replace(/\s/g, ''))}/${encodeURIComponent(a.label)}`,
        via: r.meta.via,
        date: r.meta.via === 'snapshot' ? r.meta.snapshotDate : r.meta.fetchedAt.slice(0, 10),
        lawId: r.doc.id,
        lawKind: r.doc.kind ?? 'law',
        effectiveAt: r.doc.effectiveAt,
        fetchedAt: r.meta.fetchedAt,
        contentHash: await sha256(a.text),
        partial: true,
        note: [r.meta.note, '해당 법령에서 관련 조문을 발췌한 근거입니다. 법령 전체와 부칙·별표·별지 확인은 별도로 필요합니다.'].filter(Boolean).join(' '),
      });
    }
  }
  return { evidence, vias, notes };
}

export function evidenceText(ev: Evidence[]): string {
  return ev.map((e) => `${e.id} ${e.label} [${evidenceSourceLabel(e)}; 시행일 ${e.effectiveAt ?? '미확인'}; 조회시각 ${e.fetchedAt ?? '미기록'}; 자료 기준일 ${e.date ?? '미확인'}${e.partial ? '; 일부 발췌' : ''}]\n출처: ${e.url ?? (e.via === 'user' ? '사용자 입력' : '원문 URL 미기록')}${e.note ? `\n범위: ${e.note}` : ''}\n${e.text.slice(0, 3000)}${e.text.length > 3000 ? '\n[길이 제한으로 이하 생략. 전체 조문 확인 필요]' : ''}`).join('\n\n');
}

export function evidenceSourceLabel(e: Evidence): string {
  return e.via === 'snapshot' ? `저장본·현행 여부 별도 확인(${e.date ?? '기준일 미확인'})`
    : e.via === 'user' ? '사용자 제공·공식 원문 대조 필요'
    : e.via === 'relay' ? '공식 API 중계 조회' : '공식 API 조회';
}

export function evidenceRecordText(e: Evidence): string {
  return `${e.id} ${e.label} — ${evidenceSourceLabel(e)}\n시행일: ${e.effectiveAt ?? '미확인'} · 조회/등록 시각: ${e.fetchedAt ?? '미기록'}${e.date ? ` · 자료 기준일: ${e.date}` : ''}${e.lawId ? ` · 법령 식별자: ${e.lawId}` : ''}\n원문 지문(SHA-256): ${e.contentHash ?? '이전 작업: 지문 미기록'}${e.url ? `\n출처: ${e.url}` : ''}${e.note ? `\n조회 범위: ${e.note}` : e.partial ? '\n일부 발췌 근거입니다.' : ''}`;
}
