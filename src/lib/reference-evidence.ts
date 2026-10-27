import type { LawDoc } from '@/server/law';
import { sha256, type Evidence } from './project';
import { MAX_SIMILAR_REFERENCES, officialRuleUrl, type SimilarRuleReference } from './similar-rules';

export function referenceBody(doc: LawDoc): string {
  return [doc.title, ...doc.articles.map(article => {
    const text = article.text.trim();
    const heading = `${article.label}${article.title ? `(${article.title})` : ''}`;
    // The official parser returns the body without its heading. A body can
    // begin with a citation such as "제3조의2에 따른 ..."; a matching number
    // alone is never proof that the article heading is already present.
    const tail = text.slice(heading.length);
    const explicitHeading = !!article.title && text.startsWith(heading) &&
      (!tail || /^\s/.test(tail)) &&
      !/^\s+(?:(?:및|또는|부터|에서)(?:\s|$)|제\s*\d+\s*(?:항|호|목))/.test(tail);
    return explicitHeading ? text : `${heading} ${text}`;
  })].join('\n');
}

export async function peerReferenceEvidence({ doc, meta }: SimilarRuleReference): Promise<Evidence> {
  const fullText = referenceBody(doc);
  const text = fullText.slice(0, 12000);
  return {
    id: `EV-PEER-${doc.kind}-${doc.id}`.replace(/[^A-Za-z0-9_-]/g, '-'),
    kind: 'user', label: `유사 규정 참고: 「${doc.title}」`, text, url: officialRuleUrl(doc),
    via: meta.via, lawId: doc.id, lawKind: doc.kind, effectiveAt: doc.effectiveAt,
    date: meta.snapshotDate ?? meta.fetchedAt.slice(0, 10), fetchedAt: meta.fetchedAt,
    contentHash: await sha256(text), partial: true,
    note: `비교·입안 참고용입니다. 우리 기관에 대한 위임·수권 근거로 쓰지 않습니다. 부칙·별표·별지는 공식 원문에서 별도 확인하세요.${fullText.length > text.length ? ' 길이 제한으로 앞부분 12,000자만 보관했습니다.' : ''}`,
  };
}

export function mergePeerEvidence(previous: Evidence[], added: Evidence[]): Evidence[] {
  const merged = new Map(previous.map(item => [item.id, item]));
  for (const item of added) merged.set(item.id, item);
  if (merged.size > MAX_SIMILAR_REFERENCES) throw new Error('이 작업에는 유사 규정을 최대 4개까지 연결할 수 있어요. 아래 참고 목록에서 하나를 해제한 뒤 추가해 주세요.');
  return [...merged.values()];
}
