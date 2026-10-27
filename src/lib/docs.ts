import { buildAddenda, eulReul, eunNeun, isStatuteKind, kindSuffix, renderArticle, type Derived, type LintIssue, type Rule, type RuleKind } from '@/engine';
import { amendmentKind, replacementBody } from './amendment-method';
import { buildAuthorityReviewDoc } from './authority-doc';
import { transitionDraftHash, transitionReviewText } from './transition-review';
import { buildOpinionRequestDoc } from './opinion-request';
import { buildConsultationReviewDoc } from './consultation-review';
import { parseRule } from '@/engine';
import { buildLinkedRegulationsDoc } from './linked-regulations-doc';
import type { Profile } from '@/config/profiles';
import type { Block, Run } from './hwpx/build';
import type { Project } from './project';
import { evidenceRecordText } from './evidence';
import { knowledgePageLabel } from './knowledge';
import { version } from '../../package.json';
import type { DocumentLayout } from './document-layout';
import { CHECK_RESULTS, documentDate, draftingChecks } from './document-settings';
import { reasonInputHash } from './review';
import { periodEnd, scheduleLines, trackSummary } from './procedure-track';
import { projectProfile } from '@/config/profiles';

export interface DocModel {
  id: 'amend' | 'comparison' | 'reason' | 'notice' | 'checklist' | 'full' | 'enact' | 'outline' | 'authority' | 'transitions' | 'opinion' | 'consultation' | 'linked' | 'schedule';
  name: string; // 문서 이름(파일명)
  title: string;
  blocks: Block[];
  note?: string;
  layout?: DocumentLayout;
  formSource?: { label: string; url: string; adaptation: string };
}

const P = (text: string, o: Partial<Run> = {}, align?: 'center' | 'left' | 'justify' | 'hang'): Extract<Block, { type: 'p' }> => ({ type: 'p', runs: [{ text, ...o }], align });
const BLANK: Block = { type: 'p', runs: [] };
const LEGAL_SOURCE = { label: '자치법규 입안 길라잡이 2026 · PDF 416–420쪽(본문 408–412쪽)', url: '/references/local-ordinance-2026.pdf#page=416', adaptation: '매뉴얼의 용지·글꼴·문단 규격을 적용한 편집 가능한 초안' };
const CHECK_SOURCE = { label: '자치법규 입안 길라잡이 2026 · PDF 531–535쪽(본문 523–527쪽)', url: '/references/local-ordinance-2026.pdf#page=531', adaptation: '12항 체크리스트 흐름도를 검토 결과·메모를 기록하는 표로 재구성' };
const NOTICE_SOURCE = { label: '자치법규 입안 길라잡이 2026 · PDF 538–541쪽(본문 530–533쪽)', url: '/references/local-ordinance-2026.pdf#page=538', adaptation: '예고 필수 기재사항에 따라 재구성한 서식 · 기관의 공고 서식과 최종 대조' };
const STATUTE_SOURCE = { label: '법령 입안·심사 기준 2026 · PDF 811쪽(본문 745쪽) 일부개정 방식', url: '/references/legislation-2026.pdf#page=811', adaptation: '법령안 제명·개정지시문 방식을 적용한 편집 가능한 초안 · 법제처 법령안 편집기와 최종 대조' };
/** 의회·국무회의 등 공식 입법 절차를 거치는 규정(자치법규 + 국가 법령) */
const isLegislative = (kind: RuleKind) => kind === 'ordinance' || kind === 'rule' || isStatuteKind(kind);
const legalLayout = (kind: RuleKind, comparison = false): DocumentLayout => isLegislative(kind) ? comparison ? 'comparison' : 'legislation' : 'support';
const legalSource = (kind: RuleKind) => isStatuteKind(kind) ? STATUTE_SOURCE : kind === 'ordinance' || kind === 'rule' ? LEGAL_SOURCE : undefined;

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

export function noticeEnd(start: Date, days: number): Date {
  // 초일 불산입(「민법」 제157조), 말일이 토요일·공휴일이면 다음 날(「민법」 제161조)
  const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const [y, m, d] = periodEnd(iso, days).date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const GA = '가나다라마바사아자차카타파하';

export function buildAmendDocs(p: Project, before: Rule, d: Derived, prof: Profile): DocModel[] {
  if (amendmentKind(p) !== 'partial') return buildWholeAmendDocs(p, before, d, prof);
  const kind = kindSuffix(before);
  const billTitle = `${before.title} 일부개정${kind}안`;
  const docs: DocModel[] = [];

  // 1 개정안(개정문 + 부칙)
  const amend: Block[] = [P(billTitle, { size: 'title' }, 'center'), BLANK, P(d.amend.header)];
  for (const s of d.amend.sentences) {
    amend.push(P(s.text));
    for (const b of s.body ?? []) amend.push(P(b, {}, 'hang'));
  }
  amend.push(BLANK, P('부      칙', { bold: true }, 'center'), ...d.amend.addendaText.map((t) => P(t)));
  // '별지와 같이 한다'고 선언한 별표·서식의 개정 본문을 같은 개정안에 붙인다.
  for (const annex of d.after.annexes) {
    const old = before.annexes.find((x) => x.uid === annex.uid);
    if (old && old.title === annex.title && old.text === annex.text) continue;
    const n = `${annex.num}${annex.br ? `의${annex.br}` : ''}`;
    const label = annex.kind === 'table' ? `별표 ${n}` : `별지 제${n}호서식`;
    amend.push(BLANK, P(`[${label}] ${annex.title}`, { bold: true }), ...annex.text.split('\n').map((line) => P(line)));
  }
  docs.push({ id: 'amend', name: '개정안', title: billTitle, blocks: amend, layout: legalLayout(before.kind), formSource: legalSource(before.kind) });

  // 2 신·구조문대비표
  const style = prof.style;
  docs.push({
    id: 'comparison',
    name: '신구조문대비표',
    title: `${billTitle} 신·구조문대비표`,
    layout: legalLayout(before.kind, true),
    formSource: legalSource(before.kind),
    blocks: [
      P(`${billTitle} 신·구조문대비표`, { size: 'title' }, 'center'),
      BLANK,
      {
        type: 'table',
        widths: [1, 1],
        rows: [
          { head: true, cells: [[[{ text: '현      행', bold: true }]], [[{ text: '개   정   안', bold: true }]]] },
          ...d.comparison.map((r) => ({ cells: [r.left.map((l) => l.map((s) => ({ text: s.text, underline: s.underline }))), r.right.map((l) => l.map((s) => ({ text: s.text, underline: s.underline })))] })),
        ],
      },
    ],
    note: style.unchangedMark === 'dash' ? '바뀌지 않은 글자는 "------"로 줄였습니다(기관 프로필에서 바꿀 수 있음).' : undefined,
  });

  // 3 개정이유·주요내용
  docs.push({ id: 'reason', name: '개정이유및주요내용', title: billTitle, blocks: reasonBlocks(p, billTitle, '개정', d), layout: legalLayout(before.kind), formSource: legalSource(before.kind) });

  // 4 규정 종류에 맞는 예고·의견수렴 검토 문서
  docs.push(noticeDoc(p, billTitle, '개정', prof, before.kind));

  // 5 입안 점검표
  docs.push({ id: 'checklist', name: '입안점검표', title: `${billTitle} 입안 점검표`, blocks: checklistBlocks(p, billTitle, d.lint, reasonInputHash(p, d.specHash)), formSource: checklistSource(p.kind) });

  // (참고) 개정 후 전문
  docs.push({ id: 'full', name: '개정후전문(참고)', title: `${before.title}(개정 후 전문)`, blocks: d.fullText.split('\n').map((l, i) => (i === 0 ? P(l, { size: 'title' }, 'center') : P(l))), layout: legalLayout(before.kind) });
  return [...docs, ...supportDocuments(p, d.after, before)];
}

function reasonBlocks(p: Project, billTitle: string, word: '개정' | '제정' | '폐지', d?: Derived): Block[] {
  const pr = p.prose;
  const laws = [...new Set(p.evidence.filter((e) => e.kind === 'law').map((e) => e.label.replace(/\(.*\)$/, '')))];
  const b: Block[] = [
    P(billTitle, { size: 'title' }, 'center'),
    BLANK,
    P(`1. ${word}이유`, { bold: true, size: 'heading' }),
    P(pr?.reason ?? '(이유를 작성하세요)'),
    BLANK,
    P('2. 주요내용', { bold: true, size: 'heading' }),
    ...(pr?.mainPoints ?? []).map((m, i) => P(`${GA[i] ?? '-'}. ${m}`, {}, 'hang')),
    BLANK,
    P('3. 참고사항', { bold: true, size: 'heading' }),
    P(`가. 관계법령: ${laws.length ? laws.join(', ') : '[담당자 확인 필요]'}`, {}, 'hang'),
    P(`나. 예산조치: ${p.documentSettings?.reference?.budget?.trim() || '[재정 수반 여부와 비용추계서 작성 대상 여부 확인 필요]'}`, {}, 'hang'),
    P(`다. 합    의: ${p.documentSettings?.reference?.consultation?.trim() || '[관계부서·기관 협의 대상 및 결과 작성]'}`, {}, 'hang'),
    P(`라. 기    타: ${p.documentSettings?.reference?.other?.trim() || (word === '개정' && amendmentKind(p) === 'partial' ? '신·구조문대비표 별첨' : '신·구조문대비표 해당 없음')}`, {}, 'hang'),
  ];
  void d;
  return b;
}

function noticeDoc(p: Project, billTitle: string, word: '개정' | '제정' | '폐지', prof: Profile, kind: RuleKind): DocModel {
  const legislative = isLegislative(kind);
  const internal = kind === 'bylaw';
  const name = legislative ? '입법예고문' : internal ? '기관내부의견수렴문(검토용)' : '행정예고문(검토용)';
  const label = legislative ? '입법예고' : internal ? '기관 내부 의견수렴(검토용)' : '행정예고(검토용)';
  return { id: 'notice', name, title: `${billTitle} ${label}`, blocks: noticeBlocks(p, billTitle, word, prof, kind, label), formSource: legislative ? NOTICE_SOURCE : { label: '행정규칙 입안·심사 기준 2025 · 예고·협의 절차 참고', url: '/references/administrative-rules-2025.pdf#page=24', adaptation: '기관 종류와 규정 성격에 맞게 재구성한 의견수렴 검토 서식' } };
}

function noticeBlocks(p: Project, billTitle: string, word: '개정' | '제정' | '폐지', prof: Profile, kind: RuleKind, label: string): Block[] {
  const today = new Date();
  const legislative = isLegislative(kind);
  const internal = kind === 'bylaw';
  const fields = p.documentSettings?.notice;
  const no = fields?.number?.trim() || prof.noticeNo.replace('{yyyy}', String(today.getFullYear())).replace('{n}', '○○○');
  const name = p.enact?.title ?? p.title;
  // 공식 조문 확인: https://law.go.kr/법령/행정절차법 (제41조·제46조).
  // 규정 종류만으로 예고 의무·예외·기간을 확정하지 않는다.
  const intro = legislative
    ? `「${name}」${eulReul(name)} ${word}하면서 그 취지와 주요내용을 미리 알려 의견을 듣고자 「행정절차법」 제41조에 따라 다음과 같이 공고합니다.`
    : internal
      ? `「${name}」 ${word}안에 관한 기관 내부 의견을 수렴하고자 합니다. 의견조회 대상·절차·기간은 기관 정관 및 규정에 따라 담당자가 확정합니다.`
      : `「${name}」 ${word}안의 취지와 주요내용에 관한 의견을 수렴하기 위한 행정예고 초안입니다. 「행정절차법」 제46조에 따른 행정예고 대상 여부와 예외를 확인한 후 사용하세요.`;
  const check = internal
    ? '담당자 확인: 기관 규정에 따른 의견조회 대상, 회신 기한, 제출 방법 및 공개 범위를 확정하세요.'
    : '담당자 확인: 적용 법령에 따른 예고 대상·예외·기간을 검토하고 공고일, 의견 제출 기한, 제출처 및 공개 장소를 확정하세요.';
  const shortOrg = prof.name.split(' ').pop() ?? prof.name;
  const issuer = fields?.issuer?.trim() || (shortOrg.endsWith(prof.headTitle[0]) ? `${shortOrg.slice(0, -1)}${prof.headTitle}` : `${shortOrg}${prof.headTitle}`);
  const deadline = documentDate(fields?.deadline) || (internal ? '[확정한 회신 기한]' : '[확정한 의견 제출 기한]');
  const contact = fields?.department?.trim() || prof.opinionContact;
  const details = [fields?.address?.trim() && `주소: ${fields.address.trim()}`, fields?.phone?.trim() && `전화: ${fields.phone.trim()}`, fields?.email?.trim() && `전자우편: ${fields.email.trim()}`].filter(Boolean).join(' / ');
  return [
    P(internal ? fields?.number?.trim() || '[기관 내부 문서번호 확인 후 작성]' : no),
    P(`${billTitle} ${label}`, { size: 'title' }, 'center'),
    P(intro),
    P(check, { size: 'small' }),
    P(documentDate(fields?.date) || (internal ? '[의견조회일 확인 후 작성]' : '[공고일 확인 후 작성]'), {}, 'center'),
    P(issuer, { bold: true }, 'center'),
    P(`1. ${word}이유`, { bold: true }),
    P(p.prose?.reason ?? '(이유)'),
    P('2. 주요내용', { bold: true }),
    ...(p.prose?.mainPoints ?? []).map((m, i) => P(`${GA[i] ?? '-'}. ${m}`, {}, 'hang')),
    P('3. 의견제출', { bold: true }),
    P(internal
      ? `의견조회 대상 부서는 ${deadline}까지 다음 사항을 적은 검토 의견을 제출하여 주시기 바랍니다.`
      : `이 안에 대하여 의견이 있는 기관·단체 또는 개인은 ${deadline}까지 다음 사항을 적은 의견서를 제출하여 주시기 바랍니다.`),
    P(`가. ${internal ? '검토안' : '예고사항'}에 대한 항목별 의견(찬반 여부와 그 사유)`, {}, 'hang'),
    P(internal ? '나. 부서명, 담당자 및 업무 연락처' : '나. 성명(단체는 단체명과 대표자 성명) 및 의견 확인에 필요한 연락처', {}, 'hang'),
    P(`다. 제출처: ${contact}`, {}, 'hang'),
    ...(details ? [P(details, {}, 'hang')] : []),
    P(`라. 제출방법: ${fields?.method?.trim() || '[실제 운영할 제출 방법 작성]'}`, {}, 'hang'),
    P(`4. ${internal ? '검토안 공유' : '예고안 전문 공개'}: ${fields?.website?.trim() || (internal ? '[검토안 공유 위치 및 문의처 작성]' : '[예고안 전문 공개 장소 및 누리집 주소 작성]')}`),
    P(`붙임: ${word === '제정' ? '제정안' : word === '폐지' ? '폐지안' : amendmentKind(p) === 'full' ? '전부개정안' : '일부개정안 및 신·구조문대비표'} 1부.`),
    ...(fields?.extra?.trim() ? [P(`그 밖의 사항: ${fields.extra.trim()}`)] : []),
  ];
}

/** Full amendment and repeal have distinct enactment instructions and attachments. */
function buildWholeAmendDocs(p: Project, before: Rule, d: Derived, prof: Profile): DocModel[] {
  const repeal = amendmentKind(p) === 'repeal';
  const method = repeal ? '폐지' : '전부개정';
  const title = `${before.title} ${method}${kindSuffix(before)}안`;
  const body: Block[] = [P(title, { size: 'title' }, 'center'), BLANK];
  if (repeal) body.push(P(`${before.title}${eunNeun(before.title)} 폐지한다.`));
  else body.push(P(`${before.title} 전부를 다음과 같이 개정한다.`), BLANK, ...(p.replacementDraft && d.after.articles.length ? replacementBody(d.after).split('\n') : ['[작성 필요] 전부개정 본칙·별표·서식을 작성해 주세요.']).map(line => P(line)));
  const reviewRule = repeal ? before : d.after;
  body.push(BLANK, P('부      칙', { bold: true }, 'center'), ...buildAddenda(p.kind, p.spec.addenda, transitionDraftHash(reviewRule, p.spec.addenda), reviewRule).map(line => P(line)));
  const pending = !p.amendmentDecision?.note.trim() ? '[작성 필요] 작업 방식을 선택한 이유' : p.amendmentDecision.note;
  const result: DocModel[] = [
    { id: 'amend', name: `${method}안`, title, blocks: body, layout: legalLayout(p.kind), formSource: legalSource(p.kind) },
    { id: 'reason', name: `${repeal ? '폐지' : '개정'}이유및주요내용`, title, blocks: reasonBlocks(p, title, repeal ? '폐지' : '개정'), layout: legalLayout(p.kind), formSource: legalSource(p.kind) },
    noticeDoc(p, title, repeal ? '폐지' : '개정', prof, p.kind),
    { id: 'checklist', name: '입안점검표', title: `${title} 입안 점검표`, blocks: [...checklistBlocks(p, title, d.lint, reasonInputHash(p, d.specHash)), BLANK, P(`${method} 방식 선택 기록`, { bold: true }), P(pending), P('종전 부칙, 진행 중인 신청·계약·제재와 다른 규정의 인용을 별도로 확인하세요.')], formSource: checklistSource(p.kind) },
  ];
  return [...result, ...supportDocuments(p, repeal ? before : d.after, before)];
}

function supportDocuments(p: Project, rule: Rule, before?: Rule): DocModel[] {
  const title = `${p.enact?.title ?? p.title} 기존 업무 적용관계 검토표`;
  return [buildAuthorityReviewDoc(p, rule), { id: 'transitions', name: '기존업무적용관계검토표', title, layout: 'support',
    blocks: [P(title, { size: 'title' }, 'center'), ...transitionReviewText(rule, p.spec.addenda, { priorRule: p.mode === 'amend' ? parseRule(p.source.raw, p.kind, p.title) : undefined, method: p.mode === 'amend' ? amendmentKind(p) : 'enact' }).split('\n').map(line => P(line))],
    formSource: { label: '자치법규 입안 길라잡이 2026 · 부칙의 적용 관계', url: '/references/local-ordinance-2026.pdf#page=362', adaptation: '기존 대상·기준 사건·적용 규정·담당자 판단을 기록하는 검토표로 재구성' } },
    ...(p.opinionRequest ? [buildOpinionRequestDoc(p)] : []), ...(p.consultationReview ? [buildConsultationReviewDoc(p, rule)] : []),
    ...(before && p.linkedRegulations?.length ? [buildLinkedRegulationsDoc(p, before, rule)] : []),
    ...(p.procedureTrack && Object.keys(p.procedureTrack.steps).length ? [buildScheduleDoc(p)] : [])];
}

/** 절차·일정 진행판에 담당자가 기록한 단계 상태로 만드는 추진 일정표(검토용). */
function buildScheduleDoc(p: Project): DocModel {
  const prof = projectProfile(p);
  const title = `${p.enact?.title ?? p.title} 제·개정 추진 일정표`;
  const summary = trackSummary(p.kind, prof, p.procedureTrack);
  const cell = (text: string, bold = false) => [[{ text, bold }]];
  return { id: 'schedule', name: '추진일정표', title, layout: 'support', blocks: [
    P(title, { size: 'title' }, 'center'),
    P(`${prof.name} · 진행 ${summary.done}/${summary.total}단계 · ${summary.current ? `지금 단계: ${summary.current.step.name}` : '모든 단계 완료 기록'}`, { size: 'small' }),
    BLANK,
    { type: 'table', widths: [0.5, 2.4, 0.9, 1.7, 2.5], rows: [
      { head: true, cells: [cell('순', true), cell('절차', true), cell('상태', true), cell('예정·완료일', true), cell('근거·메모', true)] },
      ...scheduleLines(p.kind, prof, p.procedureTrack).map(row => ({ cells: row.map(text => cell(text)) })),
    ] },
    BLANK,
    P('※ 기관 설정에 따른 업무 안내와 담당자 기록입니다. 법정 기한·예외와 실제 완료 여부는 담당자가 확인합니다.', { size: 'small' }),
  ] };
}

function checklistSource(kind: RuleKind) {
  if (isStatuteKind(kind)) return { label: '법령 입안·심사 기준 2026', url: '/references/legislation-2026.pdf', adaptation: '형식·위임·체계·규제·시행일·부칙·개정 방식 기준을 검토 기록표로 재구성' };
  return kind === 'ordinance' || kind === 'rule' ? CHECK_SOURCE : { label: '행정규칙 입안·심사 기준 2025', url: '/references/administrative-rules-2025.pdf', adaptation: '권한·위임·예고·시행·정비 기준을 검토 기록표로 재구성 · 내부규정은 기관 정관·내규와 대조' };
}

function checklistBlocks(p: Project, billTitle: string, lint: LintIssue[], hash: string, mode = p.mode): Block[] {
  const enact = mode === 'enact';
  const intro = enact ? lint : lint.filter((l) => l.origin === 'introduced');
  const pre = enact ? [] : lint.filter((l) => l.origin === 'preexisting');
  const cnt = (t: LintIssue['tier'], list = intro) => list.filter((l) => l.tier === t && !l.offline).length;
  const offline = lint.filter((l) => l.offline).length;
  const row = (l: LintIssue) => ({ cells: [[[{ text: l.code }]], [[{ text: l.where }]], [[{ text: l.message }]]] });
  const head = (a: string, b: string, c: string) => ({ head: true, cells: [[[{ text: a, bold: true }]], [[{ text: b, bold: true }]], [[{ text: c, bold: true }]]] });
  const ai = enact
    ? (p.enact?.outline ?? []).map((a, i) => ({ a, i })).filter(({ a }) => a.provenance === 'ai' || a.provenance === 'ai_accepted')
      .map(({ a, i }) => `- 제${i + 1}조(${a.title}) ${a.provenance === 'ai_accepted' ? '[담당자 확인 완료]' : '[검토 전]'}`)
    : p.spec.ops.filter((o) => o.status === 'accepted' && o.provenance !== 'human')
      .map((o) => `- ${o.why ?? ''} ${o.provenance === 'ai_accepted' ? '[수락함]' : ''}`);
  return [
    P(`${billTitle} 입안 점검표`, { size: 'title' }, 'center'),
    P(`작성일 ${fmtDate(new Date())} · 작성 도구 조목조목 v${version} · 변경명세 지문 ${hash}`, { size: 'small' }, 'center'),
    BLANK,
    P('매뉴얼 기준 검토 기록', { bold: true, size: 'heading' }),
    P(checklistSource(p.kind).label, { size: 'small' }),
    P('담당자가 입력한 검토 상태와 메모입니다. 미확인은 적합 판정이 아니며, 해당 없음도 적용 사유를 확인해야 합니다.', { size: 'small' }),
    { type: 'table', widths: [3.5, 1.1, 2.8], rows: [head('검토 항목', '상태', '검토 근거·메모'), ...draftingChecks(p.kind).map((item, index) => {
      const saved = p.documentSettings?.checks?.find(entry => entry.id === item.id);
      return { cells: [
        [[{ text: `${index + 1}. ${item.question}`, bold: true }], [{ text: item.detail, size: 'small' as const }]],
        [[{ text: `${CHECK_RESULTS[saved?.result ?? 'unreviewed']}${saved && saved.result !== 'unreviewed' && saved.sourceHash !== hash ? '\n이전 초안 기록·재확인' : ''}` }]],
        [[{ text: saved?.note.trim() || '—' }], [{ text: `자료 PDF ${item.page}쪽(본문 ${item.printed}쪽)`, size: 'small' as const }]],
      ] };
    })] },
    { ...P('자동 점검과 근거 기록', { bold: true, size: 'heading' }), pageBreakBefore: true },
    P('1. 점검 요약', { bold: true }),
    P(`반드시 고칠 것 ${cnt('must')}건 · 확인할 것 ${cnt('check')}건 · 참고 ${cnt('note')}건 · 확인 못 함 ${offline}건${enact ? '' : ` · 원래 있던 문제 ${pre.length}건`}`),
    BLANK,
    P(enact ? '2. 제정 초안에서 확인한 문제' : '2. 이번 개정으로 생긴 문제', { bold: true }),
    intro.length ? { type: 'table', widths: [1, 1.4, 4], rows: [head('항목', '위치', '내용'), ...intro.map(row)] } : P('없음'),
    ...(!enact ? [BLANK, P('3. 원래 있던 문제(참고)', { bold: true }),
      pre.length ? { type: 'table' as const, widths: [1, 1.4, 4], rows: [head('항목', '위치', '내용'), ...pre.map(row)] } : P('없음')] : []),
    BLANK,
    P(`${enact ? '3' : '4'}. 근거 법령`, { bold: true }),
    ...(p.evidence.length ? p.evidence.flatMap(e => evidenceRecordText(e).split('\n').map(line => P(line, { size: 'small' }, 'hang'))) : [P('없음')]),
    ...(p.knowledge?.length ? [BLANK, P('입안 참고자료 검색 기록', { bold: true }), P('매뉴얼은 입안 참고 기준입니다. 현행 법령·위임 근거와 개별 사안의 적법성 확인을 대신하지 않습니다.', { size: 'small' }),
      ...p.knowledge.flatMap(record => [P(`${record.role} · ${record.retrievedAt} · ${record.version}`, { size: 'small' }), ...record.citations.map(c => P(`${c.title} · ${c.edition} · ${knowledgePageLabel(c)} · ${c.id}`, { size: 'small' }, 'hang'))])] : []),
    BLANK,
    P(enact ? '4. AI가 작성한 제정 조문과 검토 상태' : '5. AI가 작성한 변경(담당자 확인 필요)', { bold: true }),
    ...(ai.length ? ai.map((entry) => P(entry, {}, 'hang')) : [P('없음')]),
    ...(p.sourceReview?.issues.length ? [BLANK, P('원문을 읽을 때 확인한 사항', { bold: true }),
      P(p.sourceReview.confirmedAt ? `사용자 원문 대조 확인: ${new Date(p.sourceReview.confirmedAt).toISOString()}` : '원문 대조 확인 미기록'),
      ...p.sourceReview.issues.map(i => P(`${i.location ? `${i.location}: ` : ''}${i.message}`, {}, 'hang'))] : []),
    ...(p.impact ? [BLANK, P('상위법 개정 영향 검토 기록', { bold: true }),
      P(`${p.impact.upperTitle} · ${p.impact.method === 'ai' ? `AI 후보 검토(${p.impact.modelLabel ?? p.impact.model ?? '모델 미기록'})` : '문자일치 후보'} · 사용자 제공 원문 기반 · 공식 원문 대조 필요`),
      ...p.impact.candidates.filter(c => p.impact!.selectedIds.includes(c.id)).flatMap(c => [
        P(`${c.target} ← ${c.upperTarget}: ${c.reason}`, {}, 'hang'),
        P(`상위법 변경 전: ${c.beforeQuote}`, { size: 'small' }, 'hang'),
        P(`상위법 변경 후: ${c.afterQuote}`, { size: 'small' }, 'hang'),
        P(`담당자 확인: ${c.checks.join(' · ')}`, { size: 'small' }, 'hang'),
      ])] : []),
    BLANK,
    P('※ 형식 점검은 규칙 엔진이 한 것이며, 내용의 타당성은 담당자와 법무 담당이 판단합니다.', { size: 'small' }),
  ];
}

export function buildEnactDocs(p: Project, rule: Rule, lint: LintIssue[], prof: Profile, hash: string): DocModel[] {
  const title = p.enact?.title ?? rule.title;
  const billTitle = `${title}안`;
  const body: Block[] = [P(billTitle, { size: 'title' }, 'center'), BLANK];
  for (const a of rule.articles) for (const l of renderArticle(a).split('\n')) body.push(P(l));
  body.push(BLANK, P('부      칙', { bold: true }, 'center'), ...buildAddenda(rule.kind, p.spec.addenda, transitionDraftHash(rule, p.spec.addenda), rule).map((line) => P(line)));
  const outline: Block[] = [
    P(`${title} 조문 체계표`, { size: 'title' }, 'center'),
    BLANK,
    {
      type: 'table',
      widths: [0.8, 1.4, 3.2, 2],
      rows: [
        { head: true, cells: [[[{ text: '조', bold: true }]], [[{ text: '제목', bold: true }]], [[{ text: '담은 내용', bold: true }]], [[{ text: '근거', bold: true }]]] },
        ...(p.enact?.outline ?? []).map((a, i) => ({
          cells: [[[{ text: `제${i + 1}조` }]], [[{ text: a.title }]], [[{ text: a.paragraphs.filter((paragraph) => paragraph.trim()).join('\n') }]], [[{ text: (a.evidence ?? []).map((id) => p.evidence.find((e) => e.id === id)?.label ?? id).join(', ') || '—' }]]],
        })),
      ],
    },
  ];
  return [
    { id: 'enact', name: '제정안', title: billTitle, blocks: body, layout: legalLayout(rule.kind), formSource: legalSource(rule.kind) },
    { id: 'reason', name: '제정이유및주요내용', title: billTitle, blocks: reasonBlocks(p, billTitle, '제정'), layout: legalLayout(rule.kind), formSource: legalSource(rule.kind) },
    { id: 'outline', name: '조문체계표', title: `${title} 조문 체계표`, blocks: outline },
    noticeDoc(p, billTitle, '제정', prof, rule.kind),
    { id: 'checklist', name: '입안점검표', title: `${billTitle} 입안 점검표`, blocks: checklistBlocks(p, billTitle, lint, hash, 'enact'), formSource: checklistSource(p.kind) },
    ...supportDocuments(p, rule),
  ];
}
