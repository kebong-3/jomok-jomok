import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseRule } from '@/engine';
import { profileById } from '@/config/profiles';
import type { Project } from '@/lib/project';
import { buildAmendDocs } from '@/lib/docs';
import { deriveProject } from '@/lib/amendment-method';
import manifest from '@/data/knowledge/manifest.json';

/** Independent fixtures are fictional and do not certify an actual ordinance. */
function fixture(): Project {
  const raw = '가상시 문화 지원 조례\n제1조(지원) 문화 활동을 지원한다.\n제2조(신청) 신청서를 제출한다.\n부칙\n제1조(시행일) 이 조례는 공포한 날부터 시행한다.\n제2조(종전 경과조치) 기존 수급자에게 종전 특별 기준을 적용한다.';
  return { id: 'independent-v08', createdAt: 1, updatedAt: 1, mode: 'amend', title: '가상시 문화 지원 조례', kind: 'ordinance', profileId: 'hanbit-city', source: { type: 'paste', raw, hash: '' }, intent: '문화 지원 기준을 정비한다.', spec: { ops: [{ id: 'partial-old', status: 'accepted', provenance: 'human', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 1 } }, find: '문화 활동', replace: '생활 문화 활동' } }], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [], prose: { reason: '문화 지원 체계를 정비하려는 것임.', mainPoints: ['지원 체계를 정비함.'], reviewed: false, via: 'template', specHash: '' } };
}

function outputs(p: Project) {
  const before = parseRule(p.source.raw, p.kind, p.title);
  const d = deriveProject(p, before);
  const docs = buildAmendDocs(p, before, d, profileById(p.profileId));
  const bill = docs.find(doc => doc.id === 'amend')!;
  const text = (id: string) => JSON.stringify(docs.find(doc => doc.id === id)?.blocks ?? []);
  return { before, d, docs, bill, text };
}

describe('v0.8 다른 역할의 독립 반례 검수', () => {
  it('핵심 원본 5종이 manifest 바이트·SHA-256과 일치하며 자료 판본을 보존한다', () => {
    const documents = manifest.documents.filter(document => document.id !== 'source-guide');
    expect(documents).toHaveLength(5);
    for (const document of documents) {
      const bytes = readFileSync(`public/references/${document.fileName}`);
      expect(bytes.length, document.id).toBe(document.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), document.id).toBe(document.sha256);
    }
  });

  it('전부개정→폐지→일부개정 전환 시 새 본문·종전 본문·부분 변경을 혼합하지 않는다', () => {
    const original = fixture();
    const full: Project = { ...original, amendmentKind: 'full', replacementDraft: { raw: '가상시 문화 지원 조례\n제1조(새 체계) 새 지원 절차를 운영한다.\n제2조(대상) 지원 대상은 주민으로 한다.' } };
    const fullOutput = outputs(full);
    expect(fullOutput.bill.title).toContain('전부개정조례안');
    expect(fullOutput.text('amend')).toContain('새 지원 절차');
    expect(fullOutput.text('amend')).not.toContain('생활 문화 활동');
    expect(fullOutput.text('amend')).not.toContain('종전 특별 기준');
    expect(fullOutput.docs.some(doc => doc.id === 'comparison')).toBe(false);

    const repeal = outputs({ ...full, amendmentKind: 'repeal' });
    expect(repeal.bill.title).toContain('폐지조례안');
    expect(repeal.text('amend')).toContain('폐지한다');
    expect(repeal.text('amend')).not.toContain('새 지원 절차');
    expect(repeal.text('amend')).not.toContain('생활 문화 활동');
    expect(repeal.docs.some(doc => doc.id === 'comparison')).toBe(false);

    const partial = outputs({ ...full, amendmentKind: 'partial' });
    expect(partial.bill.title).toContain('일부개정조례안');
    expect(partial.d.fullText).toContain('생활 문화 활동');
    expect(partial.text('amend')).toContain('생활 문화');
    expect(partial.text('amend')).not.toContain('새 지원 절차');
    expect(partial.docs.some(doc => doc.id === 'comparison')).toBe(true);
    expect(full.source.raw).toBe(original.source.raw);
    expect(full.replacementDraft?.raw).toContain('새 지원 절차');
  });

  it('전부개정·폐지 이유서에서 실제 문서 세트에 없는 신구조문대비표를 붙임이라고 안내하지 않는다', () => {
    const p = fixture();
    for (const amendmentKind of ['full', 'repeal'] as const) {
      const result = outputs({ ...p, amendmentKind, replacementDraft: { raw: '가상시 문화 지원 조례\n제1조(지원) 새 지원 절차를 운영한다.' } });
      expect(result.text('reason'), amendmentKind).not.toContain('신·구조문대비표 별첨');
    }
  });

  it('새 본문이 없는 전부개정은 일부개정 결과를 완성한 새 본문으로 취급하지 않는다', () => {
    const result = outputs({ ...fixture(), amendmentKind: 'full' });
    expect(result.d.lint.some(issue => issue.tier === 'must' && /전부개정/.test(`${issue.where} ${issue.message} ${issue.title}`))).toBe(true);
    expect(result.text('amend')).not.toContain('생활 문화 활동');
  });
});
