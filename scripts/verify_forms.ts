/** Reproducible fictional export fixture; no live AI, credentials or resident data. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { derive, parseRule } from '../src/engine';
import { buildAmendDocs, buildEnactDocs } from '../src/lib/docs';
import { toDocx, toHwpx } from '../src/lib/export';
import { profileById, snapshotProfile } from '../src/config/profiles';
import type { Project } from '../src/lib/project';
import { LOCAL_DRAFTING_CHECKS } from '../src/lib/document-settings';

const output = process.argv[2] ?? '/tmp/jomokjomok-forms';
const profile = profileById('hanbit-city');
const source = '한빛시 검증용 회의자료 제출 조례\n제1조(목적) 이 조례는 서식 검증을 위한 가상 회의자료 제출 기준을 정함을 목적으로 한다.\n제2조(제출방법) 담당자는 회의 개최 3일 전까지 담당부서에 전자우편으로 자료를 제출하여야 한다.\n제3조(접수확인) 담당부서는 자료를 접수한 날의 다음 날까지 접수 여부를 확인하여야 한다.';
const base: Project = {
  id: 'fictional-forms', title: '한빛시 검증용 회의자료 제출 조례', createdAt: 0, updatedAt: 0, mode: 'amend', kind: 'ordinance', profileId: profile.id, profileSnapshot: snapshotProfile(profile), source: { type: 'paste', raw: source, hash: '' },
  intent: '제2조의 3일을 5일로 조정', evidence: [], log: [], excludedFixes: [],
  spec: { ops: [{ id: 'days', status: 'accepted', provenance: 'human', why: '제출기한 조정', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 2 } }, find: '3일', replace: '5일' } }], addenda: { effective: 'date', date: '2027-01-01' } },
  prose: { reason: '회의자료의 사전 검토 시간을 확보하기 위하여 자료 제출기한을 회의 개최 3일 전에서 5일 전으로 조정하려는 것임.', mainPoints: ['회의자료 제출기한을 회의 개최 5일 전으로 조정함(안 제2조).'], specHash: 'forms', via: 'template', reviewed: true },
  documentSettings: {
    notice: { number: '한빛시 공고 제2026-123호', date: '2026-10-26', deadline: '2026-11-16', issuer: '한빛시장', department: '한빛시 총무과', phone: '000-000-0000', email: 'example@example.invalid', address: '가상시 가상로 1', method: '전자우편 또는 방문', website: 'https://example.invalid/notice' },
    reference: { budget: '추가 예산 없음(서식 검증용 가상값)', consultation: '관계부서 협의 예정', other: '서식 검증용 가상 사례' },
    checks: LOCAL_DRAFTING_CHECKS.map((item, index) => ({ id: item.id, result: index === 0 ? 'checked' : index === 4 ? 'not_applicable' : 'unreviewed', note: index === 0 ? '검증용 가상 기준이며 실제 조례 입법이 아님.' : index === 4 ? '서식 시험을 위한 가상 입력값' : '', sourceHash: 'forms' })),
  },
};
await mkdir(output, { recursive: true });
const rule = parseRule(source, 'ordinance');
const amended = derive(rule, base.spec);
base.documentSettings!.checks!.forEach(item => { item.sourceHash = amended.specHash; });
const enacted: Project = { ...base, mode: 'enact', source: { type: 'none', raw: '', hash: '' }, spec: { ops: [], addenda: base.spec.addenda }, enact: { title: base.title, outlineConfirmed: true, outline: [
  { id: 'a1', title: '목적', paragraphs: ['이 조례는 서식 검증을 위한 가상 회의자료 제출 기준을 정함을 목적으로 한다.'], provenance: 'human' },
  { id: 'a2', title: '제출방법', paragraphs: ['담당자는 회의 개최 3일 전까지 담당부서에 전자우편으로 자료를 제출하여야 한다.'], provenance: 'human' },
  { id: 'a3', title: '접수확인', paragraphs: ['담당부서는 자료를 접수한 날의 다음 날까지 접수 여부를 확인하여야 한다.'], provenance: 'human' },
] }, prose: { ...base.prose!, reason: '회의자료의 제출과 접수 확인에 관한 기준을 정하려는 것임.', mainPoints: ['자료 제출방법과 제출기한을 정함(안 제2조).', '접수 여부 확인기한을 정함(안 제3조).'] } };
const report: unknown[] = [];
for (const [mode, docs] of [['amend', buildAmendDocs(base, rule, amended, profile)], ['enact', buildEnactDocs(enacted, rule, [], profile, amended.specHash)]] as const) {
  for (const doc of docs) {
    const name = `${mode}-${doc.id}`;
    await writeFile(path.join(output, `${name}.docx`), await toDocx(doc));
    await writeFile(path.join(output, `${name}.hwpx`), toHwpx(doc));
    await writeFile(path.join(output, `${name}.json`), JSON.stringify(doc, null, 2));
    report.push({ name, layout: doc.layout ?? 'support', formSource: doc.formSource, blocks: doc.blocks.length });
  }
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ fixture: 'fictional-hanbit-city', documents: report }, null, 2));
console.log(`Generated ${report.length} DOCX/HWPX pairs in ${output}`);
