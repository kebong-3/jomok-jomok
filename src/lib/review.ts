import { hashText } from '@/engine';
import type { Project, ProseBlock } from './project';

/** Bind review to all material drafting inputs, including title and addenda. */
export function reasonInputHash(p: Project, amendmentHash = ''): string {
  return hashText(JSON.stringify({
    version: 2, mode: p.mode, title: p.enact?.title ?? p.title,
    ...(p.mode === 'amend' && p.amendmentKind && p.amendmentKind !== 'partial' ? { amendmentKind: p.amendmentKind, replacement: p.replacementDraft?.raw } : {}),
    kind: p.kind, profileId: p.profileId, addenda: p.spec.addenda,
    intent: p.mode === 'enact' ? p.purpose : p.intent,
    content: p.mode === 'enact'
      ? (p.enact?.outline ?? []).map(a => ({ title: a.title, paragraphs: a.paragraphs, evidence: a.evidence }))
      : amendmentHash,
    evidence: p.evidence.map(e => ({ id: e.id, text: e.text, effectiveAt: e.effectiveAt, contentHash: e.contentHash })),
    ...(p.profileSnapshot ? { profileSnapshot: p.profileSnapshot } : {}),
  }));
}

/** A fingerprint upgrade must not erase a previously edited reason statement. */
export function migrateLegacyReasonReview(p: Project, amendmentHash = ''): ProseBlock | undefined {
  if (!p.prose) return undefined;
  const currentHash = reasonInputHash(p, amendmentHash);
  if (p.prose.specHash === currentHash) return undefined;
  const legacyHash = p.mode === 'enact' ? hashText(JSON.stringify(p.enact?.outline ?? [])) : amendmentHash;
  const priorProfileHash = p.profileSnapshot ? reasonInputHash({ ...p, profileSnapshot: undefined }, amendmentHash) : undefined;
  if ((!legacyHash || p.prose.specHash !== legacyHash) && p.prose.specHash !== priorProfileHash) return undefined;
  // Legacy fingerprints did not bind every material input. Preserve the text but
  // ask the user to review it again under the current, broader fingerprint.
  return { ...p.prose, specHash: currentHash, reviewed: false };
}
