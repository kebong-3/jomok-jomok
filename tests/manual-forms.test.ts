import { describe, expect, it } from 'vitest';
import { derive, parseRule } from '@/engine';
import { profileById } from '@/config/profiles';
import { buildAmendDocs, buildEnactDocs, type DocModel } from '@/lib/docs';
import { documentSettingsSchema, LOCAL_DRAFTING_CHECKS } from '@/lib/document-settings';
import { parseProjectBackup, serializeProjectBackup } from '@/lib/project-transfer';
import type { Project } from '@/lib/project';

const docText = (doc: DocModel) => doc.blocks.map(b => b.type === 'p' ? b.runs.map(r => r.text).join('') : b.rows.map(r => r.cells.flat(2).map(t => t.text).join('\n')).join('\n')).join('\n');
function fixture(): Project {
  return { id: 'forms', createdAt: 1, updatedAt: 1, mode: 'enact', kind: 'ordinance', title: '한빛시 검증용 조례', profileId: 'hanbit-city',
    source: { type: 'none', raw: '', hash: '' }, intent: '', excludedFixes: [], evidence: [], log: [], spec: { ops: [], addenda: { effective: 'promulgation' } },
    prose: { reason: '자료 제출 기준을 정하려는 것임.', mainPoints: ['제출과 접수 확인'], via: 'template', specHash: 'current', reviewed: true },
    documentSettings: { notice: { number: '한빛시 공고 제2026-123호', date: '2026-10-26', deadline: '2026-11-16', department: '한빛시 총무과', phone: '000-000-0000', email: 'example@example.invalid', address: '가상시 가상로 1', method: '전자우편 또는 방문', website: 'https://example.invalid/notice' }, reference: { budget: '추가 예산 없음(검토용 가상값)', consultation: '법무부서 검토 예정' }, checks: [{ id: 'local-01', result: 'checked', note: '제정 필요성을 검토함', sourceHash: 'current' }, { id: 'local-05', result: 'not_applicable', note: '외부 주민의 의무 부과 없음', sourceHash: 'previous' }] },
  };
}

describe('매뉴얼 기준 서식과 담당자 입력', () => {
  it('예고문 필수항목을 제정·개정에 공통 적용하고 날짜를 임의 계산하지 않는다', () => {
    const p = fixture(); const rule = parseRule('한빛시 검증용 조례\n제1조(목적) 자료 제출 기준을 정한다.', 'ordinance'); const profile = profileById('hanbit-city');
    const docs = [...buildEnactDocs(p, rule, [], profile, 'current'), ...buildAmendDocs(p, rule, derive(rule, p.spec), profile)];
    for (const notice of docs.filter(d => d.id === 'notice')) {
      const body = docText(notice);
      for (const required of ['한빛시 공고 제2026-123호', '2026. 10. 26.', '2026. 11. 16.', '한빛시 총무과', 'example@example.invalid', '전자우편 또는 방문', 'https://example.invalid/notice', '붙임:']) expect(body).toContain(required);
      expect(notice.formSource?.adaptation).toContain('재구성');
    }
    p.documentSettings = undefined;
    const notice = buildEnactDocs(p, rule, [], profile, 'current').find(d => d.id === 'notice')!;
    expect(docText(notice)).toContain('[공고일 확인 후 작성]');
    expect(docText(notice)).toContain('[확정한 의견 제출 기한]');
  });

  it('매뉴얼의 12항을 전부 포함하며 미확인·해당없음·이전초안의 검토 상태를 구분한다', () => {
    const p = fixture(); const rule = parseRule('한빛시 검증용 조례\n제1조(목적) 자료 제출 기준을 정한다.', 'ordinance');
    const checklist = docText(buildEnactDocs(p, rule, [], profileById('hanbit-city'), 'current').find(d => d.id === 'checklist')!);
    expect(LOCAL_DRAFTING_CHECKS).toHaveLength(12);
    for (const item of LOCAL_DRAFTING_CHECKS) expect(checklist).toContain(item.question);
    expect(checklist).toContain('미확인');
    expect(checklist).toContain('해당 없음\n이전 초안 기록·재확인');
    expect(checklist).toContain('제정 필요성을 검토함');
    expect(checklist).not.toContain('적법 판정 완료');
  });

  it('서식 입력값과 항목별 검토 기록이 백업에 보존되고 날짜·중복항목 오류를 거른다', async () => {
    const p = fixture();
    expect((await parseProjectBackup(await serializeProjectBackup(p))).project.documentSettings).toEqual(p.documentSettings);
    expect(documentSettingsSchema.safeParse({ notice: { date: '2026-02-30' } }).success).toBe(false);
    const check = { id: 'local-01', result: 'checked', note: '' };
    expect(documentSettingsSchema.safeParse({ checks: [check, check] }).success).toBe(false);
    expect(documentSettingsSchema.safeParse({ notice: { method: 'x'.repeat(501) } }).success).toBe(false);
  });
});
