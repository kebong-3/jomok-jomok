// 조목이 동행 도우미 — 작업 상태를 사람이 말하듯 풀어 주고, 다음 행동을 버튼으로 이어 준다.
// 순수 함수만 둔다. 법적 판단을 내리지 않고, 화면에 이미 계산된 사실만 말한다.
import type { JomokiMood } from '@/components/Jomoki';
import { euro, finalOf } from '@/engine/josa';

/** ‘…’예요 / ‘…’이에요 */
const ieyo = (word: string) => (finalOf(word) === 'none' ? '예요' : '이에요');

export type CompanionStage = 'start' | 'articles' | 'lint' | 'docs' | 'procedure';
export type CompanionActionId =
  | 'go-articles' | 'go-lint' | 'go-docs' | 'go-procedure' | 'review' | 'open-chat'
  | 'accept-all' | 'start-work' | 'focus-source' | 'focus-intent' | 'retry-ai' | 'go-settings';

export interface CompanionAction { id: CompanionActionId; label: string; primary?: boolean }
export interface CompanionBrief { key: string; mood: JomokiMood; status: string; lines: string[]; actions: CompanionAction[] }

/** 작업 화면이 이미 계산한 값의 요약(법적 판단 없음). */
export interface WorkSnapshot {
  mode: 'amend' | 'enact';
  method: 'partial' | 'full' | 'repeal' | 'enact';
  stage: Exclude<CompanionStage, 'start'>;
  title: string;
  kindLabel: string;
  running: boolean;
  runningLabel?: string;
  planError?: string;
  viaExample: boolean;
  proposed: number;
  accepted: number;
  firstProposal?: { label: string; why?: string };
  autoFixes: number;
  must: number;
  check: number;
  outlineReady: boolean;
  enactArticles: number;
  enactMissing: number;
  enactUnreviewed: number;
  authorityPending: number;
  reasonReady: boolean;
  docCount?: number;
  noticeDeadlineSet: boolean;
  trackDone: number;
  trackTotal: number;
  currentStep?: string;
  nextDeadline?: { label: string; date: string };
}

const go = (stage: WorkSnapshot['stage']): CompanionActionId => (stage === 'articles' ? 'go-articles' : stage === 'lint' ? 'go-lint' : stage === 'docs' ? 'go-docs' : 'go-procedure');
const ask: CompanionAction = { id: 'open-chat', label: '조목이에게 묻기' };

/** 현재 작업 상태에서 조목이가 할 말과 바로 할 수 있는 행동 */
export function workBrief(s: WorkSnapshot): CompanionBrief {
  const key = (...parts: (string | number | boolean | undefined)[]) => [s.stage, ...parts].join('|');
  if (s.running) {
    return { key: key('running', s.runningLabel), mood: 'thinking', status: '작업 중',
      lines: [s.mode === 'enact' ? '제정 목적과 근거를 읽으면서 조문을 차례로 쓰고 있어요.' : '개정 의도와 현행 원문을 맞춰 보면서 고칠 곳을 찾고 있어요.', s.runningLabel ? `지금은 ‘${s.runningLabel}’ 단계예요. 끝나면 바로 알려 드릴게요.` : '조금만 기다려 주세요. 끝나면 바로 알려 드릴게요.'],
      actions: [] };
  }
  if (s.planError) {
    return { key: key('error'), mood: 'care', status: '연결 확인',
      lines: ['AI 연결이 잠깐 원활하지 않았어요.', '직접 고치기로 계속하거나, 설정에서 연결을 확인한 뒤 다시 실행할 수 있어요.'],
      actions: [{ id: 'retry-ai', label: 'AI 다시 실행', primary: true }, { id: 'go-settings', label: '연결 확인' }] };
  }
  const example = s.viaExample ? ' (지금은 예시 응답이에요)' : '';

  if (s.stage === 'procedure') {
    if (!s.currentStep) return { key: key('proc-done'), mood: 'celebrate', status: '절차 완료', lines: ['기록한 절차를 모두 마쳤어요. 정말 수고 많으셨어요!', '추진 일정표는 문서 받기에서 함께 내려받을 수 있어요.'], actions: [{ id: 'go-docs', label: '문서 받기', primary: true }] };
    return { key: key('proc', s.currentStep, s.trackDone, s.nextDeadline?.date), mood: 'guide', status: `${s.trackDone}/${s.trackTotal} 완료`,
      lines: [`지금은 ‘${s.currentStep}’ 단계예요.`, s.nextDeadline ? `챙길 날짜: ${s.nextDeadline.label} — ${s.nextDeadline.date}. 잊지 않게 알려 드릴게요.` : '예고 시작일을 넣어 주시면 의견제출 마감일을 바로 계산해 드릴게요.'],
      actions: [ask] };
  }

  if (s.stage === 'articles') {
    if (s.mode === 'enact') {
      if (!s.enactArticles) return { key: key('enact-empty'), mood: 'care', status: '체계 필요', lines: ['아직 조문 체계가 없어요.', '‘AI 다시 실행’으로 체계를 만들거나, 제정 목적을 조금 더 구체적으로 적어 주세요.'], actions: [{ id: 'retry-ai', label: 'AI 다시 실행', primary: true }, ask] };
      if (!s.outlineReady) return { key: key('outline', s.enactArticles), mood: 'smile', status: '체계 확인', lines: [`목적에 맞춰 ${s.enactArticles}개 조로 체계를 잡아 봤어요${example}.`, '조 제목과 순서를 보시고, 빠진 조가 있으면 더하거나 빼 주세요. 확정하면 본문을 쓸게요.'], actions: [ask] };
      if (s.enactMissing) return { key: key('missing', s.enactMissing), mood: 'guide', status: `${s.enactMissing}개 남음`, lines: [`${s.enactArticles}개 조 중 ${s.enactMissing}개가 아직 비어 있어요.`, '이어 쓰기를 누르면 빈 조문만 채우고, 직접 고친 문장은 그대로 둘게요.'], actions: [ask] };
      if (s.enactUnreviewed) return { key: key('unreviewed', s.enactUnreviewed), mood: 'care', status: '검토 필요', lines: [`초안을 다 썼어요${example}. 제가 쓴 ${s.enactUnreviewed}개 조문은 꼭 한 번 봐 주세요.`, '특히 적용 대상·권한·금액·시행일은 담당자님 판단이 필요해요.'], actions: [{ id: 'review', label: '같이 검토하기', primary: true }, { id: 'go-lint', label: '점검으로' }] };
      return { key: key('enact-ok'), mood: 'laugh', status: '초안 완료', lines: ['조문 초안이 모두 확인됐어요!', '이제 형식 점검으로 인용·용어·부칙을 확인할 차례예요.'], actions: [{ id: 'go-lint', label: '점검하기', primary: true }] };
    }
    if (s.method === 'repeal') return { key: key('repeal'), mood: 'care', status: '폐지 검토', lines: ['폐지는 조문을 하나씩 지우지 않아도 돼요.', '대신 진행 중인 신청·계약과 다른 규정의 인용을 꼭 같이 살펴요.'], actions: [{ id: 'go-lint', label: '폐지 전 점검', primary: true }] };
    if (s.proposed) {
      const lines = [`개정 의도를 읽고 고칠 곳 ${s.proposed + s.accepted}건을 제안했어요${example}.`];
      if (s.firstProposal) lines.push(`먼저 ‘${s.firstProposal.label}’부터 볼까요?${s.firstProposal.why ? ` ${s.firstProposal.why}` : ''}`);
      lines.push('바꾸기 전·후 문장을 보고 수락만 눌러 주세요. 번호 이동과 인용 정리는 제가 할게요.');
      return { key: key('proposed', s.proposed), mood: 'smile', status: `제안 ${s.proposed}건`, lines, actions: [{ id: 'accept-all', label: '남은 제안 모두 수락…' }, ask] };
    }
    if (!s.accepted) return { key: key('none'), mood: 'guide', status: '변경 없음', lines: ['아직 반영한 변경이 없어요.', '‘AI 없이 직접 고치기’로 바로 입력하셔도 대비표와 개정문은 제가 맞춰 드려요.'], actions: [ask] };
    if (s.must) return { key: key('must', s.must), mood: 'care', status: `고칠 곳 ${s.must}`, lines: [`${s.accepted}건을 반영했어요.${s.autoFixes ? ` 번호가 바뀐 인용 ${s.autoFixes}곳은 제가 함께 고쳤어요.` : ''}`, `그런데 지운 조항을 가리키는 문장이 ${s.must}곳 남았어요. 점검에서 같이 정리해요.`], actions: [{ id: 'go-lint', label: '점검에서 고치기', primary: true }] };
    return { key: key('accepted', s.accepted), mood: 'laugh', status: `반영 ${s.accepted}건`, lines: [`${s.accepted}건을 반영했어요.${s.autoFixes ? ` 번호가 바뀐 인용 ${s.autoFixes}곳도 함께 고쳤어요.` : ''}`, '신·구조문대비표와 개정문에 벌써 들어갔어요. 이제 점검으로 넘어가요.'], actions: [{ id: 'go-lint', label: '점검하기', primary: true }] };
  }

  if (s.stage === 'lint') {
    if (s.must) return { key: key('lint-must', s.must), mood: 'care', status: `고칠 곳 ${s.must}`, lines: [`반드시 고칠 곳이 ${s.must}곳 있어요.`, '위치를 누르면 해당 조문으로 가요. 수정 제안이 있으면 골라서 반영만 하시면 돼요.'], actions: [ask] };
    if (s.authorityPending) return { key: key('authority', s.authorityPending), mood: 'guide', status: `근거 ${s.authorityPending}`, lines: ['형식 문제는 없어요.', `다만 조문 ${s.authorityPending}개는 누구에게 적용하는지, 근거가 허용하는 범위인지 담당자님 확인이 남았어요.`], actions: [{ id: 'go-docs', label: '먼저 문서 받기' }, ask] };
    return { key: key('lint-ok'), mood: 'laugh', status: '점검 통과', lines: ['자동 점검에서 반드시 고칠 문제를 찾지 못했어요!', '이유서와 부칙을 확인하고 문서를 받을 차례예요.'], actions: [{ id: 'go-docs', label: '문서 받기', primary: true }] };
  }

  // docs
  const lines = [`${s.docCount ? `문서 ${s.docCount}종` : '문서 한 벌'}이 준비됐어요. 한글(HWPX)·워드로 바로 받을 수 있어요.`];
  if (!s.reasonReady) lines.push('제·개정이유는 아직 확인 전이에요. 한 번 읽어 보시고 확인을 눌러 주세요.');
  else if (!s.noticeDeadlineSet) lines.push('예고문의 의견제출 기한이 비어 있어요. 절차·일정에서 날짜를 넣으면 제가 계산해서 채워 드릴게요.');
  else lines.push('다음은 결재와 예고 절차예요. 단계와 기한은 절차·일정에서 함께 챙겨요.');
  return { key: key('docs', s.reasonReady, s.noticeDeadlineSet), mood: 'smile', status: '문서 준비', lines, actions: [{ id: 'go-procedure', label: '절차·일정 챙기기', primary: true }, ask] };
}

/** 이전 상태와 비교해 순간 반응(축하·주의)을 만든다. 없으면 null. */
export function workReaction(prev: WorkSnapshot | undefined, next: WorkSnapshot): CompanionBrief | null {
  if (!prev || prev.stage !== next.stage) return null;
  if (prev.running && !next.running && !next.planError) {
    if (next.mode === 'amend' && next.proposed) return { key: `done-plan|${next.proposed}`, mood: 'celebrate', status: '제안 완료', lines: [`다 됐어요! 고칠 곳 ${next.proposed}건을 찾아 왔어요.`, next.firstProposal ? `첫 번째는 ‘${next.firstProposal.label}’${ieyo(next.firstProposal.label)}.` : '하나씩 같이 봐요.'], actions: [] };
    if (next.mode === 'enact' && next.enactArticles) return { key: `done-enact|${next.enactArticles}`, mood: 'celebrate', status: '작성 완료', lines: [`조문 ${next.enactArticles}개를 준비했어요!`, '제목과 순서부터 같이 살펴봐요.'], actions: [] };
  }
  if (next.accepted > prev.accepted) {
    const n = next.accepted - prev.accepted;
    const fixed = next.autoFixes - prev.autoFixes;
    return { key: `accepted|${next.accepted}`, mood: 'celebrate', status: '반영 완료', lines: [n > 1 ? `${n}건을 한꺼번에 반영했어요!` : '반영했어요!', fixed > 0 ? `번호가 밀린 인용 ${fixed}곳도 제가 같이 고쳐 뒀어요.` : '대비표와 개정문에 바로 들어갔어요.'], actions: [] };
  }
  if (prev.must > 0 && next.must === 0) return { key: `must-cleared|${next.accepted}`, mood: 'laugh', status: '정리 완료', lines: ['반드시 고칠 곳을 모두 정리했어요. 꼼꼼하시네요!'], actions: [] };
  if (next.trackDone > prev.trackDone) return { key: `track|${next.trackDone}`, mood: 'celebrate', status: `${next.trackDone}/${next.trackTotal}`, lines: [next.currentStep ? `한 단계 끝! 다음은 ‘${next.currentStep}’${ieyo(next.currentStep)}.` : '모든 단계를 마쳤어요!'], actions: [] };
  return null;
}

/** 시작 화면의 입력 상태 요약 */
export interface StartSnapshot {
  mode: 'amend' | 'enact';
  sample: boolean;
  hasSource: boolean;
  title?: string;
  articles: number;
  annexes: number;
  sourceIssues: number;
  sourceConfirmed: boolean;
  intentLength: number;
  purposeLength: number;
  kindLabel: string;
  statuteMismatch: boolean;
  peers: number;
}

export function startBrief(s: StartSnapshot): CompanionBrief {
  const k = (...parts: (string | number | boolean | undefined)[]) => ['start', s.mode, ...parts].join('|');
  if (s.statuteMismatch) return { key: k('statute'), mood: 'care', status: '기관 확인', lines: [`${s.kindLabel}${finalOf(s.kindLabel) === 'none' ? '를' : '을'} 고르셨네요.`, '국가 법령은 중앙행정기관 설정(예: 한빛부)을 고르면 입법예고 40일·법제처 심사 절차로 안내해 드릴게요.'], actions: [ask] };
  if (s.mode === 'amend') {
    if (!s.hasSource) return { key: k('nosrc'), mood: 'wave', status: '1단계', lines: ['안녕하세요, 조목이에요!', '고칠 규정을 법제처에서 찾거나 붙여넣어 주세요. 조·항·호를 바로 읽어 드릴게요.'], actions: [{ id: 'focus-source', label: '원문 넣으러 가기', primary: true }, ask] };
    if (!s.articles) return { key: k('noparse'), mood: 'care', status: '원문 확인', lines: ['조문을 찾지 못했어요.', '“제1조(목적) …”처럼 조 번호가 있는 원문인지 확인해 주세요.'], actions: [ask] };
    const read = `${s.title ? `「${s.title}」 ` : ''}${s.articles}개 조${s.annexes ? `, 별표·서식 ${s.annexes}개` : ''}를 읽었어요.`;
    if (s.sourceIssues && !s.sourceConfirmed) return { key: k('issues', s.sourceIssues), mood: 'care', status: `확인 ${s.sourceIssues}`, lines: [read, `원문에서 확인할 곳이 ${s.sourceIssues}곳 있어요. 원본과 대조하고 확인 표시를 해 주세요.`], actions: [ask] };
    if (s.intentLength < 6) return { key: k('intent'), mood: 'smile', status: '2단계', lines: [read, '이제 바꾸고 싶은 내용을 평소 말하듯 적어 주세요. 예) “위원 수를 10명에서 15명으로 늘려 주세요.”'], actions: [{ id: 'focus-intent', label: '바꿀 내용 적기', primary: true }] };
    return { key: k('ready'), mood: 'laugh', status: '준비 완료', lines: [read, s.sample ? '예시가 모두 채워졌어요. 시작하면 고칠 곳부터 제안할게요!' : '좋아요! 시작하면 고칠 곳을 찾아 제안하고, 번호·인용 정리까지 맡을게요.'], actions: [{ id: 'start-work', label: '조목이와 작업 시작', primary: true }] };
  }
  if (s.purposeLength < 6) return { key: k('purpose'), mood: 'wave', status: '1단계', lines: ['새 규정을 만드시는군요!', `${s.kindLabel}${euro(s.kindLabel)} 무엇을 하려는지 한두 문장으로 적어 주세요. 조문 체계부터 같이 잡아요.`], actions: [{ id: 'focus-intent', label: '목적 적기', primary: true }, ask] };
  return { key: k('enact-ready', s.peers), mood: 'laugh', status: '준비 완료', lines: [s.peers ? `참고할 유사 규정 ${s.peers}개도 연결했어요.` : '유사 규정을 1~3개 연결하면 더 현실적인 조문을 쓸 수 있어요(선택).', '시작하면 목적 → 정의 → 실체 규정 → 보칙 순서로 체계를 제안할게요.'], actions: [{ id: 'start-work', label: '조목이와 작업 시작', primary: true }] };
}

/** 질문을 앱 행동으로 바꿀 수 있으면 바꾼다(AI 호출 없이 즉시 처리). */
export type LocalIntent = { action: CompanionActionId; reply: string } | null;
export function localIntent(text: string, stage: CompanionStage): LocalIntent {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (stage !== 'start') {
    if (/(일정|마감|기한|언제까지|절차|예고\s*기간|공포\s*기한)/.test(t) && /(보여|알려|계산|열어|챙겨|어디|뭐|언제)/.test(t)) return { action: 'go-procedure', reply: '절차·일정 진행판을 열었어요. 기준일을 넣으면 마감일을 바로 계산해 드려요.' };
    if (/(대비표|문서|한글|hwpx|워드|docx|다운|내려)/i.test(t) && /(받|보여|열어|어디|만들)/.test(t)) return { action: 'go-docs', reply: '문서 받기로 왔어요. 위에서 문서를 고르고 한글·워드로 받으시면 돼요.' };
    if (/(점검|오류|틀린|문제)/.test(t) && /(보여|열어|확인|있어|있나|어디)/.test(t)) return { action: 'go-lint', reply: '점검 화면을 열었어요. 반드시 고칠 것부터 위에 모아 뒀어요.' };
    if (/(조문|제안)/.test(t) && /(보여|열어|돌아가)/.test(t)) return { action: 'go-articles', reply: '조문 화면으로 돌아왔어요.' };
    if (/(모두|전부|다)\s*수락/.test(t)) return { action: 'accept-all', reply: '남은 제안을 한 번에 수락할 수 있게 확인창을 띄울게요. 근거를 확인하지 않은 수락은 점검표에 그대로 기록돼요.' };
  }
  if (/^(다음|이제|그럼)?\s*(뭐|무엇|뭘)\s*(해야|하면|할까)/.test(t) || /다음\s*할\s*일/.test(t)) return { action: 'open-chat', reply: '' };
  return null;
}

/** 단계별로 직원들이 자주 묻는 질문 */
export function suggestedQuestions(stage: CompanionStage, mode: 'amend' | 'enact', kindLabel: string): string[] {
  if (stage === 'start') return mode === 'enact'
    ? [`${kindLabel}${euro(kindLabel)} 정해야 할지 헷갈려요`, '제정할 때 꼭 들어가야 하는 조문은?', '위임 근거가 없으면 어떻게 되나요?']
    : ['일부개정과 전부개정은 어떻게 골라요?', '개정 의도는 어떻게 적으면 좋아요?', '부칙에 경과조치가 필요한 경우는?'];
  if (stage === 'articles') return mode === 'enact'
    ? ['정의 조항은 어떻게 쓰는 게 좋아요?', '위원회 조항에 꼭 넣을 내용은?', '“~할 수 있다”와 “~하여야 한다” 차이는?']
    : ['조를 신설할 때 가지번호와 번호 밀기 중 뭐가 나아요?', '항을 삭제하면 번호는 어떻게 돼요?', '이 개정에 경과조치가 필요할까요?'];
  if (stage === 'lint') return ['삭제한 조항을 인용하면 어떻게 고쳐요?', '주민 권리를 제한하려면 위임 근거가 꼭 필요해요?', '시행일은 언제로 하는 게 좋아요?'];
  if (stage === 'docs') return ['개정이유는 어떻게 쓰면 좋아요?', '입법예고를 생략할 수 있는 경우는?', '신·구조문대비표 작성 요령은?'];
  return ['입법예고 기간은 어떻게 계산해요?', '조례규칙심의회는 언제 거쳐요?', '공포 후 보고는 어디에 해요?'];
}

/** 질문 의도에 맞는 자료실 검토 방식 */
export function assistModeFor(question: string, hasDocument: boolean): 'explain' | 'review' | 'plain_language' {
  if (hasDocument && /(쉽게|쉬운|다듬|어려운\s*말|읽기\s*쉽)/.test(question)) return 'plain_language';
  if (hasDocument && /(검토|문제\s*없|괜찮|봐\s*줘|확인해\s*줘|맞아\?|맞나)/.test(question)) return 'review';
  return 'explain';
}

/** 타이핑 효과를 위한 글자 단위 분해(한글 조합 문자 보존) */
export function typingFrames(text: string): string[] {
  return Array.from(text.normalize('NFC'));
}
