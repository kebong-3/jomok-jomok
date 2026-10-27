import { describe, expect, it } from 'vitest';
import { buildAddenda, derive, parseRule, type LintIssue, type RuleKind } from '@/engine';
import { buildAmendDocs, buildEnactDocs, type DocModel } from '@/lib/docs';
import { profileById } from '@/config/profiles';
import type { Project } from '@/lib/project';
import { version } from '../package.json';

const text = (doc: DocModel) => doc.blocks.map((block) => block.type === 'p'
  ? block.runs.map((run) => run.text).join('')
  : block.rows.map((row) => row.cells.flat().flat().map((run) => run.text).join('')).join('\n')).join('\n');

function documents(kind: RuleKind) {
  const before = parseRule('시험 규정\n제1조(목적) 기준은 3일로 한다.', kind);
  const project: Project = {
    id: 'doc-test', title: before.title, kind, mode: 'amend', createdAt: 0, updatedAt: 0,
    profileId: 'seogu', source: { type: 'paste', raw: '', hash: '' }, intent: '',
    spec: { ops: [], addenda: { effective: 'promulgation' } }, evidence: [], excludedFixes: [], log: [],
  };
  const derived = derive(before, project.spec);
  const profile = profileById('seogu');
  return { project, before, profile, amended: buildAmendDocs(project, before, derived, profile), enacted: buildEnactDocs(project, before, [], profile, 'test') };
}

describe('시행일 문장의 종류별 조사', () => {
  it.each<[RuleKind, string]>([
    ['ordinance', '이 조례는'], ['rule', '이 규칙은'], ['directive', '이 훈령은'],
    ['established_rule', '이 예규는'], ['notice', '이 고시는'], ['guideline', '이 지침은'], ['bylaw', '이 내규는'],
  ])('%s의 은·는을 개정·제정 문서에 동일하게 적용한다', (kind, subject) => {
    expect(buildAddenda(kind, { effective: 'promulgation' })[0].startsWith(subject)).toBe(true);
    const { amended, enacted } = documents(kind);
    expect(text(amended.find((doc) => doc.id === 'amend')!)).toContain(subject);
    expect(text(enacted.find((doc) => doc.id === 'enact')!)).toContain(subject);
  });

  it('행정규칙의 유예 시행일은 발령 후를 기준으로 쓴다', () => {
    expect(buildAddenda('guideline', { effective: 'months', months: 2 })[0]).toBe('이 지침은 발령 후 2개월이 경과한 날부터 시행한다.');
    expect(buildAddenda('rule', { effective: 'months', months: 2 })[0]).toBe('이 규칙은 공포 후 2개월이 경과한 날부터 시행한다.');
  });
});

describe('규정 유형별 의견수렴 문서', () => {
  it('훈령·예규·고시·지침은 행정예고 검토용이며 의무와 기한을 단정하지 않는다', () => {
    for (const kind of ['directive', 'established_rule', 'notice', 'guideline'] as const) {
      const { amended, enacted } = documents(kind);
      for (const docs of [amended, enacted]) {
        const notice = docs.find((doc) => doc.id === 'notice')!;
        expect(notice.name).toBe('행정예고문(검토용)');
        expect(notice.title).toContain('행정예고(검토용)');
        const body = text(notice);
        expect(body).toContain('「행정절차법」 제46조');
        expect(body).toContain('대상 여부와 예외를 확인');
        expect(body).not.toContain('제41조');
        expect(body).toContain('[확정한 의견 제출 기한]');
        expect(body).not.toMatch(/20\d{2}\. \d{1,2}\. \d{1,2}\./);
        expect(body).toContain('서구청장');
        expect(body).not.toContain('서구구청장');
      }
    }
  });

  it('내규에는 법정 입법·행정예고를 단정하지 않는 기관 내부 의견수렴 문서를 만든다', () => {
    const { amended, enacted } = documents('bylaw');
    for (const docs of [amended, enacted]) {
      const notice = docs.find((doc) => doc.id === 'notice')!;
      expect(notice.name).toBe('기관내부의견수렴문(검토용)');
      const body = text(notice);
      expect(body).toContain('기관 정관 및 규정에 따라');
      expect(body).toContain('[확정한 회신 기한]');
      expect(body).not.toContain('행정절차법');
      expect(body).not.toContain('입법예고');
      expect(body).not.toContain('행정예고');
    }
  });

  it('조례·규칙은 입법예고 틀을 유지하고 실제 공고일과 기한은 담당자가 확정한다', () => {
    for (const kind of ['ordinance', 'rule'] as const) {
      const notice = documents(kind).amended.find((doc) => doc.id === 'notice')!;
      expect(notice.name).toBe('입법예고문');
      const body = text(notice);
      expect(body).toContain('「행정절차법」 제41조');
      expect(body).toContain('[공고일 확인 후 작성]');
      expect(body).toContain('[확정한 의견 제출 기한]');
      expect(body).not.toContain('제46조');
    }
  });

  it('제정안도 변경명세에서 지정한 시행일을 사용한다', () => {
    const { project, before, profile } = documents('guideline');
    project.spec.addenda = { effective: 'date', date: '2027-03-01' };
    const doc = buildEnactDocs(project, before, [], profile, 'test').find((item) => item.id === 'enact')!;
    expect(text(doc)).toContain('이 지침은 2027년 3월 1일부터 시행한다.');
    expect(text(doc)).not.toContain('공포한 날부터 시행한다.');
  });
});

describe('입안 점검표와 제정 조문 체계표', () => {
  const issue = (code: string, tier: LintIssue['tier'], origin: LintIssue['origin'], offline = false): LintIssue => ({
    code, tier, origin, offline, title: code, where: '제1조', message: `${code} 확인 사항`, source: 'engine',
  });

  it('제정은 현재 본문과 AI 검토 상태를 기록하고 출처 구분 없이 모든 점검 결과를 집계한다', () => {
    const { project, before, profile } = documents('guideline');
    project.mode = 'enact';
    project.enact = { title: '시험 자료공유 지침', outlineConfirmed: true, outline: [
      { id: 'purpose', title: '목적', summary: '폐기된 외부 주민 지원 요약', paragraphs: ['이 지침은 내부 자료의 공유 절차를 정함을 목적으로 한다.'], provenance: 'ai_accepted' },
      { id: 'submit', title: '제출', summary: '오래된 제출기한 7일', paragraphs: ['담당자는 자료를 요청일부터 5일 이내에 제출하여야 한다.', '전자문서로 제출할 수 있다.'], provenance: 'ai' },
      { id: 'human', title: '담당부서', paragraphs: ['담당부서는 총무과로 한다.'], provenance: 'human' },
    ] };
    const lint = [issue('필수', 'must', 'preexisting'), issue('검토', 'check', 'introduced'), issue('참고', 'note', 'preexisting'), issue('접속', 'check', 'preexisting', true)];
    const docs = buildEnactDocs(project, before, lint, profile, 'current-hash');
    const checklist = text(docs.find((doc) => doc.id === 'checklist')!);
    expect(checklist).toContain(`조목조목 v${version}`);
    expect(checklist).toContain('반드시 고칠 것 1건 · 확인할 것 1건 · 참고 1건 · 확인 못 함 1건');
    expect(checklist).toContain('제정 초안에서 확인한 문제');
    for (const item of lint) expect(checklist).toContain(item.message);
    expect(checklist).toContain('제1조(목적) [담당자 확인 완료]');
    expect(checklist).toContain('제2조(제출) [검토 전]');
    expect(checklist).not.toContain('제3조(담당부서)');
    expect(checklist).not.toContain('원래 있던 문제');
    const outline = text(docs.find((doc) => doc.id === 'outline')!);
    expect(outline).toContain('담당자는 자료를 요청일부터 5일 이내에 제출하여야 한다.\n전자문서로 제출할 수 있다.');
    expect(outline).toContain('내부 자료의 공유 절차');
    expect(outline).not.toContain('7일');
    expect(outline).not.toContain('외부 주민 지원');
  });

  it('개정은 새 문제와 원래 문제를 구분하고 수락한 AI 변경을 표시한다', () => {
    const { project, before, profile } = documents('guideline');
    project.spec.ops = [{ id: 'extend', status: 'accepted', provenance: 'ai_accepted', why: '제출기한 조정', change: {
      op: 'replace_text', target: { kind: 'unit', ref: { art: 1 } }, find: '3일', replace: '5일',
    } }];
    const derived = derive(before, project.spec);
    derived.lint = [issue('종전', 'must', 'preexisting'), issue('변경', 'check', 'introduced')];
    const checklist = text(buildAmendDocs(project, before, derived, profile).find((doc) => doc.id === 'checklist')!);
    expect(checklist).toContain('반드시 고칠 것 0건 · 확인할 것 1건 · 참고 0건 · 확인 못 함 0건 · 원래 있던 문제 1건');
    expect(checklist).toContain('2. 이번 개정으로 생긴 문제');
    expect(checklist).toContain('3. 원래 있던 문제(참고)');
    expect(checklist).toContain('제출기한 조정 [수락함]');
    expect(checklist).not.toContain('제정 초안에서 확인한 문제');
  });
});
