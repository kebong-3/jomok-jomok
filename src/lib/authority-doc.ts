import type { Rule } from '@/engine';
import type { Project } from './project';
import type { DocModel } from './docs';
import type { Block } from './hwpx/build';
import { AUTHORITY_STATUS_LABELS, MATTER_LABELS, RIGHTS_LABELS, authorityArticleReviews } from './authority-review';
import { evidenceSourceLabel } from './evidence';

const paragraph = (text: string, bold = false): Block => ({ type: 'p', runs: [{ text, bold }] });

/** Same records/status as the workroom; incomplete work remains downloadable. */
export function buildAuthorityReviewDoc(p: Project, rule: Rule): DocModel {
  const reviews = authorityArticleReviews(p, rule);
  const title = `${p.enact?.title ?? p.title} 조문별 권한·근거 검토표`;
  const blocks: Block[] = [
    { type: 'p', runs: [{ text: title, size: 'title' }], align: 'center' },
    paragraph('자동 탐지는 표현에 따른 확인 후보이며, 아래 상태는 담당자 검토 기록입니다. 적법성 승인이나 현행 법령 전체 검토를 의미하지 않습니다.'),
    paragraph('새로운 주민 권리 제한·의무 부과가 없는 자치사무에 개별 법률 위임을 일률적으로 요구하지 않습니다.'),
    { type: 'table', widths: [2.5, 2, 3.5], rows: [
      { head: true, cells: [[[{ text: '대상 조문', bold: true }]], [[{ text: '검토 상태', bold: true }]], [[{ text: '적용 대상·사무', bold: true }]]] },
      ...reviews.map(review => ({ cells: [[[{ text: review.label }]], [[{ text: AUTHORITY_STATUS_LABELS[review.status] }]], [[{ text: `${review.entry.target.trim() || '[작성 필요]'}\n${MATTER_LABELS[review.entry.matterKind]}\n${RIGHTS_LABELS[review.entry.rightsEffect]}` }]]] })),
    ] },
    ...reviews.flatMap(review => {
      const entry = review.entry;
      return [
        paragraph(review.label, true),
        paragraph(`상태: ${AUTHORITY_STATUS_LABELS[review.status]}${entry.reviewedAt ? ` · 기록 시각 ${new Date(entry.reviewedAt).toISOString()}` : ''}`),
        paragraph(`허용한 대상·내용·범위: ${entry.allowedScope.trim() || '[작성 필요 또는 해당 여부 검토]'}`),
        paragraph(`담당자 판단: ${entry.decisionNote.trim() || '[작성 필요]'}`),
        ...(entry.delegationScope.trim() ? [paragraph(`규칙 등에 맡기는 사항: ${entry.delegationScope.trim()}`)] : []),
        paragraph(`연결 근거: ${entry.evidenceIds.length ? entry.evidenceIds.map(id => {
          const evidence = p.evidence.find(item => item.id === id);
          return evidence ? `${id} ${evidence.label} · ${evidenceSourceLabel(evidence)} · 시행일 ${evidence.effectiveAt || '미확인'}${evidence.url ? ` · ${evidence.url}` : ''}` : `${id} [연결 근거 없음·재확인]`;
        }).join('\n') : '미연결'}`),
        paragraph(`근거 인용: ${entry.basisQuote.trim() || '[인용 없음]'}`),
        paragraph(`담당자의 현행성·위임 경로·범위 대조: ${entry.sourceChecked ? '직접 대조 기록 있음' : '미확인'}`),
        ...review.issues.map(issue => paragraph(`남은 확인: ${issue}`)),
      ];
    }),
    paragraph('입안 참고: 자치법규 입안 길라잡이 2026 PDF 21–26쪽(본문 13–18쪽), PDF 68쪽(본문 60쪽), PDF 75쪽(본문 67쪽). 해당 매뉴얼의 수록 시점과 개별 법령의 현재 효력은 별도로 확인합니다.'),
  ];
  return { id: 'authority', name: '조문별권한근거검토표', title, blocks, layout: 'support', formSource: { label: '자치법규 입안 길라잡이 2026 · 권한·사무 성격·위임 범위', url: '/references/local-ordinance-2026.pdf#page=68', adaptation: '매뉴얼의 판단 항목을 조문별 검토 기록으로 재구성한 서식' } };
}
