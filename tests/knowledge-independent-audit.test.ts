import { describe, expect, it } from 'vitest';
import { searchKnowledge } from '@/server/knowledge';

// Authored before seeing rankings, separately from the developer's 60 queries.
// Once two failures informed tokenizer changes, all eight became development
// counterexamples. Passing these input-contract checks is NOT legal accuracy.
const cases = [
  { name: '생활 질문', q: '분무기 물에 식초를 얼마나 섞어서 창문을 닦나요?', kind: 'ordinance', empty: true },
  { name: '원문 없는 위법 질문', q: '우리 규칙의 제12조가 위법인가요?', kind: 'rule' },
  { name: '기존 위원 임기', q: '기존에 위촉된 위원의 임기를 일괄 줄이려는데 부칙에는 무엇을 확인해야 하나요?', kind: 'ordinance' },
  { name: '반수·과반수 의미', q: '반수 이상을 과반수로 간단히 바꿔도 같은 뜻인가요?', kind: 'ordinance', mode: 'plain_language' as const },
  { name: '공단 내부기한', q: '중앙부처의 재검토기한 표준 문구를 우리 공단 내부 회계규정에 그대로 넣어야 하나요?', kind: 'bylaw' },
  { name: '조례 위임의 재위임', q: '법률에서 조례에 맡긴 사항을 다시 구청장 고시로 정하도록 해도 되는지 검토하고 싶어요.', kind: 'ordinance' },
  { name: '수록시점 밖 최신성', q: '2027년 새 법령의 최신 개정 공포 번호를 알려 주세요.', kind: 'law' },
  { name: '범위 인용의 가지조문', q: '제3조부터 제5조까지라고 쓰면 사이에 새로 넣은 제4조의2까지 포함되나요?', kind: 'ordinance' },
];

describe('독립 업무 검토자가 작성한 검색 입력 계약 (법리 답변 평가 아님)', () => {
  for (const test of cases) it(test.name, () => {
    const result = searchKnowledge(test.q, { kind: test.kind, mode: test.mode, limit: 6 });
    console.log(JSON.stringify({ name: test.name, q: test.q, hits: result.hits.map(h => ({ documentId: h.documentId, pdfPage: h.pdfPage, score: h.score, section: h.section })), note: result.note }));
    if (test.empty) expect(result.hits).toEqual([]);
    // A retrieved manual is neither a verdict about the missing source text nor
    // a live-law lookup. Both still require the explicit explanatory caveat.
    expect(result.note).toBeTruthy();
    expect(result.hits.every(h => h.id && h.contentHash && h.text)).toBe(true);
  });
});
