import { collectCitations, citationWhere } from './citations';
import { annexLabel, artLabel, findAnnex } from './labels';
import { eunNeun, iGa } from './josa';
import type { Article, ChangeOp, CitationFix, LintIssue, Rule, UnitRef } from './types';

export interface LintContext {
  /** 기관명(다른 기관명 잔재 점검용) */
  institution?: string;
  /** 법제처에서 확인된 법령명(없으면 외부 법령 확인 = 확인 못 함) */
  knownLaws?: Set<string>;
  online?: boolean;
  /** 원문 번호(정정 연산 대상 계산용) */
  oldPos?: Map<string, UnitRef>;
  inserted?: Set<string>;
  fixes?: CitationFix[];
  excludedFixes?: Set<string>;
  amendText?: string;
}

const PURIFY: [RegExp, string, string][] = [
  [/익일/g, '익일', '다음 날'],
  [/금번/g, '금번', '이번'],
  [/당해\s/g, '당해', '해당'],
  [/동법/g, '동법', '같은 법'],
  [/동조/g, '동조', '같은 조'],
  [/전항/g, '전항', '앞 항'],
];

const KNOWN_LAW_NAMES = ['지방자치법', '행정절차법', '공무원 여비 규정', '지방공무원법', '국가공무원법', '공무원보수규정', '지방재정법', '개인정보 보호법', '공공기관의 정보공개에 관한 법률'];

const ADM_KINDS = new Set(['directive', 'established_rule', 'notice', 'guideline']);

function eachPara(rule: Rule, fn: (a: Article, text: string, paraNum: number | undefined, paraUid: string) => void) {
  for (const a of rule.articles) {
    if (a.deleted) continue;
    for (const p of a.paragraphs) if (!p.deleted) fn(a, p.text, p.num, p.uid);
  }
}

function where(a: Article, para?: number) {
  return `${artLabel(a)}${para ? `제${para}항` : ''}`;
}

/** 원문 번호로 된 연산 대상(자동 고치기용). 새로 넣은 문장은 대상 아님 */
function opRef(ctx: LintContext, a: Article, paraUid: string): UnitRef | undefined {
  if (ctx.inserted?.has(paraUid) || ctx.inserted?.has(a.uid)) return undefined;
  const pa = ctx.oldPos?.get(paraUid);
  if (pa) return pa;
  return { art: a.num, artBr: a.br, para: a.paragraphs.find((p) => p.uid === paraUid)?.num };
}

export function lintRule(rule: Rule, ctx: LintContext = {}): LintIssue[] {
  const out: LintIssue[] = [];
  const add = (i: Omit<LintIssue, 'origin' | 'source'> & Partial<Pick<LintIssue, 'source'>>) => out.push({ origin: 'introduced', source: 'engine', ...i });

  // ── 반드시 ──
  // 인용-01 없는 조·항 인용
  for (const c of collectCitations(rule)) {
    const a = rule.articles.find((x) => x.num === c.target.art && (x.br ?? 0) === (c.target.artBr ?? 0));
    const w = citationWhere(c);
    if (!a) {
      add({ code: '인용-01', tier: 'must', title: '없는 조를 인용', where: w, message: `"${c.raw}"${iGa(c.raw)} 가리키는 조가 이 규정에 없습니다.` });
    } else if (c.target.para && !a.paragraphs.find((p) => p.num === c.target.para)) {
      add({ code: '인용-01', tier: 'must', title: '없는 항을 인용', where: w, message: `"${c.raw}"${iGa(c.raw)} 가리키는 항이 ${artLabel(a)}에 없습니다.` });
    } else if (c.target.para && a.paragraphs.find((p) => p.num === c.target.para)?.deleted) {
      add({ code: '인용-02', tier: 'must', title: '삭제되는 항을 인용', where: w, message: `"${c.raw}"${eunNeun(c.raw)} 삭제된 항입니다. 문장을 고쳐 써야 합니다.` });
    } else if (a.deleted) {
      add({ code: '인용-02', tier: 'must', title: '삭제되는 조를 인용', where: w, message: `"${c.raw}"${eunNeun(c.raw)} 삭제된 조입니다. 문장을 고쳐 써야 합니다.` });
    }
  }
  // 인용-02 되돌린 정정(번호가 바뀌었는데 옛 번호 그대로)
  for (const f of ctx.fixes ?? []) {
    if (f.reason === 'moved' && ctx.excludedFixes?.has(f.id)) {
      add({ code: '인용-02', tier: 'must', title: '번호가 바뀐 곳을 옛 번호로 인용', where: f.where, message: `"${f.before}"는 이번 개정으로 "${f.after}"가 되었습니다.` });
    }
  }
  // 인용-03 별표·서식 인용 대상
  const annexRe = /별표\s*(\d+)(?:의(\d+))?|별지\s*제(\d+)(?:의(\d+))?호\s*서식/g;
  eachPara(rule, (a, text, pn) => {
    for (const m of text.matchAll(annexRe)) {
      const isTable = !!m[1];
      const num = Number(m[1] ?? m[3]);
      const br = m[2] || m[4] ? Number(m[2] ?? m[4]) : undefined;
      if (!rule.annexes.length) continue;
      if (!findAnnex(rule.annexes, isTable ? 'table' : 'form', num, br)) {
        add({ code: '인용-03', tier: 'must', title: '없는 별표·서식을 인용', where: where(a, pn), message: `"${m[0]}"가 이 규정에 없습니다.` });
      }
    }
  });
  // 구조-01 조 번호 중복 / 구조-02 항 불연속
  const seen = new Set<string>();
  for (const a of rule.articles) {
    const k = artLabel(a);
    if (seen.has(k)) add({ code: '구조-01', tier: 'must', title: '조 번호 중복', where: k, message: `${k}가 두 번 있습니다.` });
    seen.add(k);
    const nums = a.paragraphs.map((p) => p.num).filter((n): n is number => n !== undefined);
    for (let i = 1; i < nums.length; i++)
      if (nums[i] !== nums[i - 1] + 1) add({ code: '구조-02', tier: 'must', title: '항 번호가 이어지지 않음', where: k, message: `${nums[i - 1]}항 다음이 ${nums[i]}항입니다.` });
  }
  // 근거-01 조례의 권리 제한·의무 부과·벌칙
  if (rule.kind === 'ordinance') {
    eachPara(rule, (a, text, pn) => {
      if (/(과태료|벌금|징역|과징금)/.test(text) && !/「[^」]+」/.test(a.paragraphs.map((p) => p.text).join(' '))) {
        add({ code: '근거-01', tier: 'must', title: '법률 위임 확인 필요', where: where(a, pn), message: '벌칙·과태료 조문에 상위 법률 근거가 보이지 않습니다. 법률 위임이 필요한 내용으로 보입니다(지방자치법 제28조제1항 단서). 법무팀 확인을 권합니다.' });
      }
    });
  }
  // 근거-02 외부 법령명 실존
  eachPara(rule, (a, text, pn) => {
    for (const m of text.matchAll(/「([^」]+)」/g)) {
      const name = m[1];
      if (ctx.knownLaws) {
        if (!ctx.knownLaws.has(name))
          add({ code: '근거-02', tier: 'must', title: '확인 안 되는 법령명', where: where(a, pn), message: `「${name}」을(를) 법제처에서 찾지 못했습니다.` });
      } else if (!KNOWN_LAW_NAMES.includes(name)) {
        add({ code: '근거-02', tier: 'check', title: '법령명 확인 못 함', where: where(a, pn), message: `「${name}」은(는) 법제처 연결 없이 확인하지 못했습니다.`, offline: true });
      }
    }
  });
  // 문형-01 개정문 금지어
  if (ctx.amendText && /(추가한다|삽입한다|폐지한다)/.test(ctx.amendText)) {
    add({ code: '문형-01', tier: 'must', title: '개정문 금지 표현', where: '개정문', message: '"추가한다·삽입한다·폐지한다" 대신 "…로 한다", "…를 신설한다", "…를 삭제한다"를 씁니다.' });
  }

  // ── 확인 ──
  // 구조-03 조 번호 결번
  const mains = rule.articles.filter((a) => !a.br).map((a) => a.num).sort((x, y) => x - y);
  for (let i = 1; i < mains.length; i++)
    if (mains[i] !== mains[i - 1] + 1) add({ code: '구조-03', tier: 'check', title: '조 번호 빈 곳', where: `제${mains[i - 1]}조 다음`, message: `제${mains[i - 1]}조 다음이 제${mains[i]}조입니다.` });
  // 용어-01 정의 용어 표기 흔들림
  const defs = new Set<string>();
  eachPara(rule, (_a, text) => {
    for (const m of text.matchAll(/"([^"]{2,20})"(?:이)?란/g)) defs.add(m[1]);
  });
  for (const d of defs) {
    if (!d.includes(' ')) {
      const spaced = new RegExp(d.split('').join('\\s?').replace(/\\s\?/g, '\\s?'));
      eachPara(rule, (a, text, pn, puid) => {
        for (const m of text.matchAll(new RegExp(spaced, 'g'))) {
          if (m[0] !== d && m[0].replace(/\s/g, '') === d) {
            const ref = opRef(ctx, a, puid);
            add({ code: '용어-01', tier: 'check', title: '정의 용어 표기 흔들림', where: where(a, pn), message: `정의한 "${d}"를 "${m[0]}"로 썼습니다.`, fix: ref ? { label: `"${d}"로 통일`, ops: [{ op: 'replace_text', target: { kind: 'unit', ref }, find: m[0], replace: d }] } : undefined });
          }
        }
      });
    }
  }
  // 부칙-03 행정규칙 재검토기한
  if (ADM_KINDS.has(rule.kind) && !rule.articles.some((a) => /재검토/.test(a.title ?? '')) && !/재검토/.test(rule.addenda)) {
    add({ code: '부칙-03', tier: 'check', title: '일몰 적용 대상 확인', where: '본칙 끝', message: '발령 기관과 내부운영 제외 여부, 적용 법령·기관 기준을 먼저 확인하세요. 일몰 조문이 필요하면 유효기간과 재검토기한의 효과를 구분하고 본칙 마지막에 담당자가 검토한 문장을 추가하세요.' });
  }
  // 기관-01 다른 기관명 잔재
  if (ctx.institution) {
    const stem = ctx.institution.replace(/\s/g, '');
    eachPara(rule, (a, text, pn) => {
      for (const m of text.matchAll(/([가-힣]{1,6}(?:특별시|광역시|특별자치시|특별자치도|시|군|구))(?:장|청|의회)/g)) {
        const name = m[1];
        if (!stem.includes(name) && !/^(시|군|구)$/.test(name) && !/^(지방자치|해당|소관|관할)/.test(name))
          add({ code: '기관-01', tier: 'check', title: '다른 기관명이 남아 있음', where: where(a, pn), message: `"${m[0]}"이(가) 보입니다. 다른 기관 규정을 참고하며 남은 이름인지 확인하세요.` });
      }
    });
  }

  // ── 참고 ──
  eachPara(rule, (a, text, pn, puid) => {
    const ref = opRef(ctx, a, puid);
    const fixOf = (find: string, replace: string, label: string): LintIssue['fix'] => (ref ? { label, ops: [{ op: 'replace_text', target: { kind: 'unit', ref }, find, replace } as ChangeOp] } : undefined);
    for (const m of text.matchAll(/(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})\.?(?!\d)/g)) {
      const good = `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.`;
      if (m[0] !== good) add({ code: '표기-01', tier: 'note', title: '날짜 표기', where: where(a, pn), message: `"${m[0]}" → "${good}"`, fix: fixOf(m[0], good, '고치기') });
    }
    for (const name of KNOWN_LAW_NAMES) {
      const re = new RegExp(`(^|[^「])${name}(?!」)(?=[에의을를은는과와 ])`, 'g');
      for (const m of text.matchAll(re)) {
        void m;
        add({ code: '표기-02', tier: 'note', title: '법령명 낫표 누락', where: where(a, pn), message: `"${name}" → "「${name}」"`, fix: fixOf(name, `「${name}」`, '고치기') });
      }
    }
    const pairs: [string, string][] = [['(', ')'], ['「', '」']];
    for (const [o, c] of pairs) {
      if (text.split(o).length !== text.split(c).length)
        add({ code: '표기-03', tier: 'note', title: '괄호 짝이 맞지 않음', where: where(a, pn), message: `"${o}"와 "${c}"의 개수가 다릅니다.` });
    }
    for (const [re, from, to] of PURIFY) {
      if (re.test(text)) add({ code: '표기-04', tier: 'note', title: '쉬운 용어로', where: where(a, pn), message: `"${from}" → "${to}"`, fix: fixOf(from, to, '고치기') });
      re.lastIndex = 0;
    }
    for (const m of text.matchAll(/제\d+조(?:의\d+)?\s+제\d+항/g)) {
      const good = m[0].replace(/\s+/g, '');
      add({ code: '표기-05', tier: 'note', title: '조·항 띄어쓰기', where: where(a, pn), message: `"${m[0]}" → "${good}"`, fix: fixOf(m[0], good, '고치기') });
    }
  });
  return out;
}

/** 개정 전 점검 결과와 비교해 "원래 있던 문제" 표시 */
export function markOrigin(after: LintIssue[], before: LintIssue[]): LintIssue[] {
  const key = (i: LintIssue) => `${i.code}|${i.message}`;
  const pre = new Set(before.map(key));
  return after.map((i) => (pre.has(key(i)) ? { ...i, origin: 'preexisting' } : i));
}

export const LINT_CATALOG: { code: string; tier: LintIssue['tier']; title: string }[] = [
  { code: '인용-01', tier: 'must', title: '없는 조·항을 인용' },
  { code: '인용-02', tier: 'must', title: '번호가 바뀌거나 삭제된 곳을 옛 번호로 인용' },
  { code: '인용-03', tier: 'must', title: '없는 별표·서식을 인용' },
  { code: '구조-01', tier: 'must', title: '조 번호 중복' },
  { code: '구조-02', tier: 'must', title: '항 번호가 이어지지 않음' },
  { code: '정합-01', tier: 'must', title: '대비표와 개정문이 서로 다름' },
  { code: '정합-02', tier: 'must', title: '수락한 변경을 적용하지 못함' },
  { code: '부칙-01', tier: 'must', title: '시행일 조항 없음' },
  { code: '근거-01', tier: 'must', title: '조례 벌칙·과태료의 법률 위임 확인' },
  { code: '근거-02', tier: 'must', title: '법제처에서 확인 안 되는 법령명' },
  { code: '문형-01', tier: 'must', title: '개정문 금지 표현(추가한다·삽입한다·폐지한다)' },
  { code: '용어-01', tier: 'check', title: '정의 용어 표기 흔들림' },
  { code: '용어-02', tier: 'check', title: '약칭을 정의 전에 사용' },
  { code: '근거-03', tier: 'check', title: '상위법 정의·수치와 다름' },
  { code: '구조-03', tier: 'check', title: '조 번호 빈 곳' },
  { code: '부칙-02', tier: 'check', title: '전부개정 시 종전 부칙 경과규정' },
  { code: '부칙-03', tier: 'check', title: '행정규칙 재검토기한' },
  { code: '부칙-04', tier: 'check', title: '일몰 적용 대상과 본칙 배치 확인' },
  { code: '기관-01', tier: 'check', title: '다른 기관명 잔재' },
  { code: '표기-01', tier: 'note', title: '날짜 표기' },
  { code: '표기-02', tier: 'note', title: '법령명 낫표' },
  { code: '표기-03', tier: 'note', title: '괄호·낫표 짝' },
  { code: '표기-04', tier: 'note', title: '쉬운 용어' },
  { code: '표기-05', tier: 'note', title: '조·항 띄어쓰기' },
];

void annexLabel;
