import { describe, expect, it } from 'vitest';
import { type KnowledgeAnswer, type KnowledgeCitation } from '@/lib/knowledge';
import { getKnowledgeChunk } from '@/server/knowledge';
import { validateKnowledgeAnswer } from '@/server/knowledge-answer';

function source(): KnowledgeCitation {
  const found = getKnowledgeChunk('KB-local-ordinance-2026-p0366-c01');
  if (!found) throw new Error('검증용 정본 발췌를 찾을 수 없습니다.');
  return found;
}
function answer(): KnowledgeAnswer {
  const c = source();
  return {
    summary: '적용 범위와 경과조치를 원문에서 확인합니다.',
    points: [{ heading: '부칙 검토', explanation: '해당 발췌를 읽고 적용 범위를 별도로 확인합니다.', citations: [{ id: c.id, quote: c.text.slice(0, 80) }] }],
    changes: [], draft: '검토 전 초안입니다.', nextSteps: ['현행 법령과 기관 원문 확인'], needsCheck: ['기관의 실제 적용 대상을 확인해야 합니다.'],
  };
}

describe('AI 설명의 기계적 인용·변경 검증', () => {
  it('서버가 전달한 원문의 정확한 인용을 유지하고 공백·정규화 차이는 허용한다', () => {
    const raw = answer();
    const quote = raw.points[0].citations[0].quote;
    raw.points[0].citations[0].quote = quote.replace(/\s+/g, '  \n').normalize('NFD');
    const result = validateKnowledgeAnswer(raw, [source()]);
    expect(result.answer?.points).toHaveLength(1);
    expect(result.answer?.points[0].citations[0].id).toBe(source().id);
    expect(result.warnings).toEqual([]);
  });

  it.each(['unknown-id', 'fake-page-id', 'invented-quote'])('없는 ID·가짜 페이지 ID·원문 밖 인용(%s)만 있으면 답변을 표시하지 않는다', (attack) => {
    const raw = answer();
    if (attack === 'unknown-id') raw.points[0].citations[0].id = 'KB-NOT-RETRIEVED';
    if (attack === 'fake-page-id') raw.points[0].citations[0].id = 'KB-local-ordinance-2026-p9999-c01';
    if (attack === 'invented-quote') raw.points[0].citations[0].quote = '모든 조례는 아무런 법률상 근거 없이 주민의 권리를 제한할 수 있다.';
    const result = validateKnowledgeAnswer(raw, [source()]);
    expect(result.answer).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('표시하지 않았습니다');
  });

  it('유효 인용만 남기고 제외된 주장에 연결될 수 있는 요약·초안은 그대로 재사용하지 않는다', () => {
    const raw = answer();
    raw.summary = '검증되지 않은 단정적 요약';
    raw.points.push({ heading: '가짜 설명', explanation: '근거 없는 설명', citations: [{ id: 'KB-FAKE', quote: '존재하지 않는 발췌문입니다.' }] });
    const result = validateKnowledgeAnswer(raw, [source()]);
    expect(result.answer?.points).toHaveLength(1);
    expect(result.answer?.summary).not.toBe(raw.summary);
    expect(result.answer?.draft).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('제외');
  });

  it('모델이 임의 페이지·출처 주소를 덧붙여도 정본 메타데이터를 덮어쓸 수 없다', () => {
    const raw = answer();
    Object.assign(raw.points[0].citations[0], { pdfPage: 9999, sourceUrl: 'https://untrusted.invalid/fake', title: '가짜 자료' });
    const checked = validateKnowledgeAnswer(raw, [source()]);
    expect(checked.answer?.points[0].citations[0]).toEqual(answer().points[0].citations[0]);
    expect(checked.answer?.points[0].citations[0]).not.toHaveProperty('pdfPage');
    expect(checked.answer?.points[0].citations[0]).not.toHaveProperty('sourceUrl');
  });

  it('사용자 초안에 실제로 없는 before와 내용이 같은 변경은 제외한다', () => {
    const raw = answer();
    const citations = raw.points[0].citations;
    raw.changes = [
      { before: '초안에 없는 문장입니다.', after: '새 문장입니다.', reason: '변경', changeType: 'wording', citations },
      { before: '임기는 3년으로 한다.', after: '임기는 3년으로 한다.', reason: '변경 없음', changeType: 'wording', citations },
    ];
    const result = validateKnowledgeAnswer(raw, [source()], '임기는 3년으로 한다.');
    expect(result.answer?.changes).toEqual([]);
    expect(result.answer?.draft).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('제외');
  });

  it.each([
    ['위원의 임기는 3년으로 한다.', '위원의 임기는 2년으로 한다.'],
    ['신청자는 자료를 제출할 수 있다.', '신청자는 자료를 제출하여야 한다.'],
    ['정원의 과반수 이상이어야 한다.', '정원의 과반수 초과이어야 한다.'],
    ['모든 위원에게 통지한다.', '일부 위원에게 통지한다.'],
    ['위원은 연임할 수 없다.', '위원은 연임할 수 있다.'],
    ['위원은 중복하여 위촉하지 않는다.', '위원은 중복하여 위촉한다.'],
    ['직원은 자료를 열람하지 못한다.', '직원은 자료를 열람한다.'],
  ])('수치·의무·범위·부정 조건 변경을 문구 정비로 숨기지 않는다: %s', (before, after) => {
    const raw = answer();
    raw.changes = [{ before, after, reason: '쉬운 문장으로 정비', changeType: 'wording', citations: raw.points[0].citations }];
    const checked = validateKnowledgeAnswer(raw, [source()], before);
    expect(checked.answer?.changes).toHaveLength(1);
    expect(checked.answer?.changes[0].changeType).toBe('substance');
    expect(checked.warnings.join(' ')).toContain('내용 변경');
  });

  it('확인할 쟁점이 없거나 인용 구조가 깨진 응답은 유효 설명으로 취급하지 않는다', () => {
    expect(validateKnowledgeAnswer({ ...answer(), needsCheck: [] }, [source()]).answer).toBeUndefined();
    expect(validateKnowledgeAnswer({ ...answer(), points: [] }, [source()]).answer).toBeUndefined();
    expect(validateKnowledgeAnswer('AI가 문자열만 반환함', [source()]).answer).toBeUndefined();
  });
});
