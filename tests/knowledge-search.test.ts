import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { KNOWLEDGE_DOCUMENTS, KNOWLEDGE_MANIFEST, citationSchema, knowledgePageLabel } from '@/lib/knowledge';
import { KnowledgeError, getKnowledgeChunk, retrieveForRole, searchKnowledge } from '@/server/knowledge';
import { GET } from '@/app/api/knowledge/search/route';

describe('입안 참고자료 검색', () => {
  it('원본 6종과 총 PDF 1,997쪽을 연결하고 파일 지문을 보존한다', () => {
    expect(KNOWLEDGE_DOCUMENTS).toHaveLength(6);
    expect(KNOWLEDGE_MANIFEST.totalPdfPages).toBe(1997);
    for (const doc of KNOWLEDGE_DOCUMENTS) {
      const original = readFileSync(`public/references/${doc.fileName}`);
      expect(original.length).toBe(doc.bytes);
      expect(createHash('sha256').update(original).digest('hex')).toBe(doc.sha256);
    }
  });
  it('부칙 적용례와 경과조치의 실제 본문을 우선 검색한다', () => {
    const r = searchKnowledge('적용례만 쓰면 기존 신청에 종전 규정이 적용되나요 경과조치', { documentIds: ['local-ordinance-2026'], limit: 6 });
    expect(r.hits.some(h => (h.pdfPage ?? 0) >= 362 && (h.pdfPage ?? 0) <= 368)).toBe(true);
    expect(r.hits[0].sectionType).toBe('body');
    for (const h of r.hits) {
      expect(citationSchema.safeParse(h).success).toBe(true);
      expect(createHash('sha256').update(h.text).digest('hex')).toBe(h.contentHash);
    }
  });
  it('가지조문을 삭제 범위에 포함하는지 관련 본문을 찾는다', () => {
    const r = searchKnowledge('제2조부터 제6조까지 삭제하면 제5조의2도 자동으로 삭제되나요?', { documentIds: ['legislation-2026'] });
    expect(r.hits.some(h => h.pdfPage === 825)).toBe(true);
    const reference = searchKnowledge('제3조부터 제5조까지라고 쓰면 사이에 새로 넣은 제4조의2까지 포함되나요?', { kind: 'ordinance' });
    expect(reference.hits[0].documentId).toBe('local-ordinance-2026');
    expect(reference.hits[0].pdfPage).toBe(440);
  });
  it('입법 내용의 재위임과 사무 재위임을 구분해 해당 본문을 우선한다', () => {
    const r = searchKnowledge('법률에서 조례에 맡긴 사항을 다시 구청장 고시로 정하도록 해도 되는지 검토하고 싶어요.', { kind: 'ordinance' });
    expect(r.hits[0].documentId).toBe('local-ordinance-2026');
    expect([23, 24]).toContain(r.hits[0].pdfPage);
    expect(r.hits.some(h => h.documentId === 'local-ordinance-2026' && h.pdfPage === 319)).toBe(false);
  });
  it('화면의 개정 방식 선택 질문에서 판단 기준과 다음 쪽의 예외를 함께 찾는다', () => {
    const r = searchKnowledge('조례를 일부개정할지 전부개정할지 판단할 때 어떤 기준과 예외를 확인해야 하나요?', { kind: 'ordinance', mode: 'explain', limit: 6 });
    expect(r.hits.slice(0, 2).map(h => [h.documentId, h.pdfPage])).toEqual([
      ['local-ordinance-2026', 421], ['local-ordinance-2026', 422],
    ]);
    const text = r.hits.slice(0, 2).map(h => h.text).join('\n');
    expect(text).toContain('3분의 2');
    expect(text).toContain('다만');
    expect(text).toContain('용어나 표현');
    expect(text).toContain('종전의 부칙');
    for (const h of r.hits.slice(0, 2)) {
      expect(getKnowledgeChunk(h.id)?.text).toBe(h.text);
      expect(createHash('sha256').update(h.text).digest('hex')).toBe(h.contentHash);
    }
  });
  it('부록 인쇄쪽 재시작을 보존하고 원문 ID를 정확히 해석한다', () => {
    const c = getKnowledgeChunk('KB-plain-language-2026-p0390-c01');
    expect(c?.pdfPage).toBe(390);
    expect(c?.printedPage).toBe('부록 100쪽');
    expect(knowledgePageLabel(c!)).toBe('PDF 390쪽 · 책자 부록 100쪽');
    expect(getKnowledgeChunk('KB-NOT-FOUND')).toBeUndefined();
  });
  it('서식에는 PDF 쪽수를 만들어 붙이지 않는다', () => {
    const r = searchKnowledge('의견제시 요청서 갑설 을설 대립 의견', { mode: 'opinion_request' });
    expect(r.hits[0].documentId).toBe('opinion-request');
    expect(r.hits[0].pdfPage).toBeNull();
    expect(r.hits[0].text).toContain('대립되는 의견이 없으면 생략');
  });
  it('무관한 질문과 공통어만 입력하면 근거가 있다고 꾸미지 않는다', () => {
    for (const q of ['피자맛집 추천', '오늘 저녁 피자 맛집 추천', '양자컴퓨팅 큐비트 오류보정', '규정 법률 조례', 'zzqxv999 astrofoo']) {
      expect(searchKnowledge(q).hits, q).toHaveLength(0);
    }
  });
  it('입력과 필터를 제한하고 임의 파일 경로를 받지 않는다', () => {
    for (const q of ['', '가', 'x'.repeat(2001)]) expect(() => searchKnowledge(q)).toThrow(KnowledgeError);
    expect(() => searchKnowledge('위임', { documentIds: ['../../.env'] })).toThrow(KnowledgeError);
    expect(() => searchKnowledge('위임', { limit: 100 })).toThrow(KnowledgeError);
    expect(() => searchKnowledge('위임', { kind: 'unknown' })).toThrow(KnowledgeError);
    expect(() => searchKnowledge('위임', { mode: 'unsafe' as 'explain' })).toThrow(KnowledgeError);
  });
  it('AI 단계 검색 기록의 발췌·출처·지문과 길이 제한을 보존한다', () => {
    const r = retrieveForRole('amend_plan', { kind: '조례', intent: '적용례와 경과조치를 구분하여 기존 신청을 보호하고 싶다.' });
    expect(r.status).toBe('retrieved');
    expect(r.citations.length).toBeGreaterThan(1);
    expect(r.citations.reduce((sum, c) => sum + c.text.length + c.title.length + c.edition.length + c.id.length + 150, 0)).toBeLessThanOrEqual(7000);
    for (const c of r.citations) expect(getKnowledgeChunk(c.id)).toEqual(c);
    expect(r.note).toContain('현재 법령');
    expect(retrieveForRole('knowledge_assist', { question: '위임' }).citations).toHaveLength(0);
  });
  it('검색 API의 오류와 정상 응답을 구별한다', async () => {
    const bad = await GET(new Request('http://localhost/api/knowledge/search?q=위임&documentIds=unknown'));
    expect(bad.status).toBe(400);
    const ok = await GET(new Request('http://localhost/api/knowledge/search?q=재검토기한&documentIds=administrative-rules-2025&limit=3'));
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.hits.length).toBeGreaterThan(0);
    expect(j.hits.length).toBeLessThanOrEqual(3);
    expect(j.hits.every((h: { documentId: string }) => h.documentId === 'administrative-rules-2025')).toBe(true);
  });
});

// These are specialist-authored retrieval questions, not labeled production
// outcomes. Record misses; this is neither legal accuracy nor a user study.
if (process.env.KNOWLEDGE_BENCHMARK === '1') {
  it('전문가 질의의 실제 검색 범위 측정', () => {
    const results: unknown[] = [];
    // The original 60 specialist questions survived the workspace reset in the
    // recorded result. Use that unchanged question set, not reconstructed prose.
    const { cases } = JSON.parse(readFileSync('docs/validation/v04-retrieval-benchmark.json', 'utf8')) as {
      cases: { q: string; docId: string; expectedPdfRanges?: number[][] }[];
    };
      for (const c of cases) {
        const kind = c.docId === 'local-ordinance-2026' ? 'ordinance' : c.docId === 'legislation-2026' ? 'law' : c.docId === 'administrative-rules-2025' ? 'directive' : undefined;
        const mode = c.docId === 'plain-language-2026' ? 'plain_language' : c.docId === 'opinion-request' ? 'opinion_request' : 'explain';
        const filtered = searchKnowledge(c.q, { documentIds: [c.docId], mode, kind, limit: 6 });
        const all = searchKnowledge(c.q, { kind, mode, limit: 6 });
        const matches = (h: { documentId: string; pdfPage: number | null }) => h.documentId === c.docId && (!c.expectedPdfRanges || c.expectedPdfRanges.some(([a,b]) => h.pdfPage !== null && h.pdfPage >= a && h.pdfPage <= b));
        results.push({ ...c, filteredHit: filtered.hits.some(matches), allHit: all.hits.some(matches),
          filteredElapsedMs: filtered.elapsedMs, allElapsedMs: all.elapsedMs, filteredPages: filtered.hits.map(h => h.pdfPage), allPages: all.hits.map(h => `${h.documentId}:${h.pdfPage}`) });
      }
    writeFileSync('/tmp/jomok-knowledge-benchmark.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ total: results.length,
      filteredHit: results.filter(r => (r as { filteredHit: boolean }).filteredHit).length,
      allHit: results.filter(r => (r as { allHit: boolean }).allHit).length }));
    expect(results).toHaveLength(60);
  });
}
