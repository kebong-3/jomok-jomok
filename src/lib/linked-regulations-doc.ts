import type { Rule } from '@/engine';
import type { Project } from './project';
import type { DocModel } from './docs';
import type { Block } from './hwpx/build';
import { analyzeLinkedRegulations, LINKED_IMPACT_LABELS } from './linked-regulations';

const paragraph = (text: string, bold = false): Block => ({ type: 'p', runs: [{ text, bold }] });

/** Recomputes candidates from current input; never exports an old approval flag. */
export function buildLinkedRegulationsDoc(p: Project, before: Rule, after: Rule): DocModel {
  const analysis = analyzeLinkedRegulations(p, before, after);
  const title = `${before.title} 다른 규정 인용 영향 후보 검토표`;
  const changed = analysis.exact.filter(item => item.impact !== 'unchanged');
  const same = analysis.exact.filter(item => item.impact === 'unchanged');
  const all = [...changed, ...analysis.uncertain, ...same];
  const displayed = all.slice(0, 200);
  const blocks: Block[] = [
    { type: 'p', runs: [{ text: title, size: 'title' }], align: 'center' },
    paragraph('인용 후보와 변경 전후 대상을 대조하는 검토 자료입니다. 자동 수정·정비 완료·적법성 승인으로 처리하지 않습니다.'),
    paragraph(`연결 규정 ${p.linkedRegulations?.length ?? 0}개 · 정확한 규정명 인용 ${analysis.exact.length}곳 · 변화·재확인 후보 ${changed.length}곳 · 규정명 불충분 후보 ${analysis.uncertain.length}곳`),
    paragraph('규정명 없는 제5조, 다른 규정명, 약칭·간접 인용·연속 인용 범위는 추정하지 않습니다. 같은 번호만으로 다른 규정이나 전부개정 조문을 동일 대상으로 연결하지 않습니다.'),
    ...analysis.coverage.flatMap(record => {
      const source = p.linkedRegulations?.find(item => item.id === record.regulationId);
      return [paragraph(`${record.title} · ${record.regulationId}`, true), paragraph(`시행일 ${source?.effectiveAt || '미확인'} · 원문 주소 ${source?.sourceUrl || '미등록'}`), ...record.issues.map(issue => paragraph(`확인 범위: ${issue}`))];
    }),
    paragraph(`인용별 후보 상세${all.length > 200 ? ' · 앞 200개 표시' : ''}`, true),
    ...(all.length > 200 ? [paragraph(`전체 ${all.length}개 중 앞 200개를 표시했습니다. 나머지 ${all.length - 200}개는 연결 원문을 다시 조회하여 확인해 주세요. 작업 보관파일에는 입력한 규정 원문을 보존합니다.`)] : []),
    ...displayed.flatMap(item => [
      paragraph(`${item.regulationTitle} · ${item.location}`, true),
      paragraph(`${LINKED_IMPACT_LABELS[item.impact]} · ${item.citation}${item.movedTo ? ` → 이동 후보 ${item.movedTo}` : ''}`),
      paragraph(`인용 문맥: ${item.excerpt}`),
      ...item.checks.map(check => paragraph(`확인할 사항: ${check}`)),
      ...(item.beforeText ? [paragraph(`변경 전 대상: ${item.beforeText}`)] : []),
      ...(item.afterText ? [paragraph(`${item.impact === 'full' ? '전부개정 같은 번호의 후보·동일성 미확정' : '변경 후 대상'}: ${item.afterText}`)] : []),
    ]),
    ...(!all.length ? [paragraph('직접 인용 후보를 찾지 못했습니다. 미입력 규정·간접 인용·원문 누락이나 다른 조문에 따른 의미 변화까지 없다고 판단한 것은 아닙니다.')] : []),
  ];
  return { id: 'linked', name: '다른규정인용영향검토표', title, blocks, layout: 'support', formSource: { label: '자치법규 입안 길라잡이 2026 · 개정 방식·인용·별표·서식 관련 검토', url: '/references/local-ordinance-2026.pdf#page=421', adaptation: '정확한 법규명 인용과 현재 작업의 변경 전후 대상을 대조하는 후보 기록표로 재구성' } };
}
