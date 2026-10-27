import type { Sample } from '@/data/samples';

/** 준비된 답변은 입력이 원래 예시와 같은 경우에만 사용할 수 있다. */
export function originalSampleId(sample: Sample | undefined, input: { raw: string; intent: string; purpose: string; upper: string; kind: string; title: string; profileId: string }): string | undefined {
  if (!sample || input.kind !== sample.kind || input.profileId !== (sample.profileId ?? 'hanbit-city')) return undefined;
  if (input.upper.trim().replace(/[「」]/g, '') !== (sample.upperLaw ?? '').trim()) return undefined;
  if (sample.mode === 'amend') return input.raw.trim() === sample.text.trim() && input.intent.trim() === sample.intent.trim() ? sample.id : undefined;
  return input.purpose.trim() === (sample.purpose ?? '').trim() && !input.title.trim() ? sample.id : undefined;
}
