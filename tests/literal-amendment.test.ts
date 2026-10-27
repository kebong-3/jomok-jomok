import { describe, expect, it } from 'vitest';
import { derive, parseRule, type ChangeOp } from '@/engine';

describe('선택한 수정 문구를 해석 없이 그대로 반영', () => {
  const literal = '계산 기호 $& 및 $$, $`와 $\'는 그대로 둔다.';
  const run = (raw: string, change: ChangeOp) => derive(parseRule(raw, 'guideline'), {
    ops: [{ id: 'literal', status: 'accepted', provenance: 'human', change }],
    addenda: { effective: 'promulgation' },
  });

  it('조문 본문에 달러 치환 패턴이 포함되어도 원문을 다시 삽입하지 않는다', () => {
    const result = run('시험 지침\n제1조(문구) 앞문장. 원래 문구. 뒷문장.', {
      op: 'replace_text', target: { kind: 'unit', ref: { art: 1 } }, find: '원래 문구.', replace: literal,
    });
    expect(result.rejected).toHaveLength(0);
    expect(result.after.articles[0].paragraphs[0].text).toBe(`앞문장. ${literal} 뒷문장.`);
  });

  it('별지 제목과 본문에서도 미리 본 수정문을 그대로 반영한다', () => {
    const raw = '시험 지침\n제1조(목적) 목적이다.\n[별지 제1호서식] 원래 제목\n원래 본문';
    for (const find of ['원래 제목', '원래 본문']) {
      const result = run(raw, { op: 'replace_text', target: { kind: 'annex', annexKind: 'form', num: 1 }, find, replace: literal });
      expect(result.rejected).toHaveLength(0);
      const annex = result.after.annexes[0];
      expect(find === '원래 제목' ? annex.title : annex.text).toBe(literal);
    }
  });
});
