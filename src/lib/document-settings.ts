import { z } from 'zod';

const optionalText = (max: number) => z.string().max(max).optional();
const date = z.string().max(10).refine(value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value));

/** User-entered publication fields. Dates and legal conclusions are never inferred. */
export const documentSettingsSchema = z.object({
  notice: z.object({
    number: optionalText(200), date: date.optional(), deadline: date.optional(),
    issuer: optionalText(120), department: optionalText(200), address: optionalText(500),
    phone: optionalText(100), email: optionalText(200), method: optionalText(500),
    website: optionalText(1000), extra: optionalText(2000),
  }).optional(),
  reference: z.object({ budget: optionalText(2000), consultation: optionalText(2000), other: optionalText(2000) }).optional(),
  checks: z.array(z.object({ id: z.string().regex(/^(?:local|admin|law)-\d{2}$/), result: z.enum(['unreviewed', 'checked', 'needs_work', 'not_applicable']), note: z.string().max(2000), sourceHash: z.string().max(200).optional() })).max(30).refine(items => new Set(items.map(i => i.id)).size === items.length).optional(),
});

export type DocumentSettings = z.infer<typeof documentSettingsSchema>;
export type DraftingCheck = { id: string; question: string; detail: string; page: number; printed: number };
export const CHECK_RESULTS = { unreviewed: '미확인', checked: '검토함', needs_work: '보완 필요', not_applicable: '해당 없음' } as const;

/** Rephrased from the manual's twelve-step flowchart, preserving its order. */
export const LOCAL_DRAFTING_CHECKS: DraftingCheck[] = [
  { id: 'local-01', question: '입법 필요성과 위임 사항', detail: '정책 실현에 새 자치법규가 필요한지, 상위법령에서 위임한 사항이 있는지 검토', page: 532, printed: 524 },
  { id: 'local-02', question: '기존 자치법규와 입법 방식', detail: '이미 같은 사항을 정한 자치법규가 있는지, 제정·일부개정·전부개정 중 적절한 방식인지 검토', page: 532, printed: 524 },
  { id: 'local-03', question: '소관 사무와 조례·규칙 선택', detail: '자치사무·단체위임사무·기관위임사무의 성격과 입법권한을 확인', page: 532, printed: 524 },
  { id: 'local-04', question: '상위법령과의 관계', detail: '상위법령에 위반되거나 같은 목적의 규율과 충돌하는 내용이 있는지 검토', page: 533, printed: 525 },
  { id: 'local-05', question: '주민의 권리·의무와 법률유보', detail: '권리 제한·의무 부과 등의 법률상 위임 근거와 범위를 확인', page: 533, printed: 525 },
  { id: 'local-06', question: '집행기관과 의회의 권한', detail: '고유권한 침해, 사전적·적극적 개입 등 견제와 균형에 관한 문제를 검토', page: 533, printed: 525 },
  { id: 'local-07', question: '시행일과 준비기간', detail: '공포 후 시행까지 준비기간이 필요한지 검토하고 시행일을 결정', page: 534, printed: 526 },
  { id: 'local-08', question: '기존 제도의 변경', detail: '기존의 처분·절차·권리관계에 필요한 경과조치 또는 적용례를 검토', page: 534, printed: 526 },
  { id: 'local-09', question: '새 제도의 적용 대상·시점', detail: '신설 제도를 언제부터 누구에게 적용할지 적용례의 필요성을 검토', page: 534, printed: 526 },
  { id: 'local-10', question: '다른 자치법규의 정비', detail: '다른 조례·규칙의 개정·폐지와 인용 정정이 필요한지 확인', page: 534, printed: 526 },
  { id: 'local-11', question: '조문 체계와 문장', detail: '규정 순서, 용어 일관성, 인용 조문, 명확성, 쉬운 표현을 확인', page: 535, printed: 527 },
  { id: 'local-12', question: '제·개정문 작성 방식', detail: '제·개정 지시문과 신·구조문대비표가 실제 변경내용과 일치하는지 확인', page: 535, printed: 527 },
];

/** Administrative rules are not automatically subjected to local-ordinance questions. */
export const ADMIN_DRAFTING_CHECKS: DraftingCheck[] = [
  { id: 'admin-01', question: '발령권한과 규정의 성격', detail: '훈령·예규·고시·지침의 성격, 발령권한과 필요한 위임 근거 확인', page: 7, printed: 3 },
  { id: 'admin-02', question: '상위법령과 위임 범위', detail: '상위법령에 없는 국민의 권리 제한·의무 부과 또는 위임 범위 일탈 여부 검토', page: 36, printed: 32 },
  { id: 'admin-03', question: '협의와 예고 절차', detail: '법제 담당 협의와 행정예고 대상·예외·기간을 해당 기관의 적용 절차에 따라 확인', page: 22, printed: 18 },
  { id: 'admin-04', question: '시행과 기존 관계', detail: '제정·전부개정 후에도 보존할 종전 부칙의 효력과 시행일·경과조치를 검토', page: 51, printed: 47 },
  { id: 'admin-05', question: '발령과 등재', detail: '기관별 발령·법제정보시스템 등재 대상, 등록할 전문·이유서 및 기한을 확인', page: 18, printed: 14 },
  { id: 'admin-06', question: '체계·용어와 문서 일치', detail: '다른 규정과 중복·상충되지 않는지, 조문 체계와 표현이 구체적이고 명확한지 확인', page: 39, printed: 35 },
  { id: 'admin-07', question: '존속기한과 재검토기한', detail: '일몰제 적용 대상·예외와 존속기한 또는 재검토기한 설정 필요성을 확인', page: 41, printed: 37 },
];

/** National statutes follow 「법령 입안·심사 기준」, not the local-ordinance flowchart. */
export const STATUTE_DRAFTING_CHECKS: DraftingCheck[] = [
  { id: 'law-01', question: '법령 형식과 소관 사항', detail: '법률·대통령령·총리령·부령 중 규정하려는 사항에 맞는 형식인지, 소관 부처가 단독으로 정할 수 있는 사항인지 확인', page: 83, printed: 17 },
  { id: 'law-02', question: '위임의 근거와 범위', detail: '하위법령에 위임할 때 구체적으로 범위를 정했는지, 위임 범위를 벗어나 권리 제한·의무 부과를 확장하지 않았는지 검토', page: 108, printed: 42 },
  { id: 'law-03', question: '다른 법령과의 관계', detail: '다른 법령과 규율 대상이 중복·상충하지 않는지, 관계 규정이나 함께 개정할 법령이 필요한지 확인', page: 143, printed: 77 },
  { id: 'law-04', question: '규제 신설·강화와 존속기한', detail: '규제를 신설·강화하는 경우 규제영향분석·규제심사 요청 대상인지, 존속기한 또는 재검토기한이 필요한지 확인', page: 701, printed: 635 },
  { id: 'law-05', question: '시행일과 준비기간', detail: '하위법령 마련 등 시행 준비기간과 관련 법령의 시행일을 함께 고려해 시행일을 정했는지 검토', page: 686, printed: 620 },
  { id: 'law-06', question: '적용례와 경과조치', detail: '새 규정의 적용 대상·시점과 종전 규정에 따른 처분·신청 등의 경과조치가 필요한지 검토', page: 714, printed: 648 },
  { id: 'law-07', question: '벌칙과 소급입법 금지', detail: '벌칙을 신설·강화하는 경우 소급 적용하는 부칙을 두지 않았는지 확인', page: 769, printed: 703 },
  { id: 'law-08', question: '제명과 개정 방식', detail: '일부개정 시 제명 유지 원칙, 제명·개정지시문(“○○법 일부를 다음과 같이 개정한다.”)과 신·구조문대비표가 일치하는지 확인', page: 811, printed: 745 },
];

export function draftingChecks(kind: string): DraftingCheck[] {
  if (kind === 'act' || kind === 'decree' || kind === 'ministry_rule') return STATUTE_DRAFTING_CHECKS;
  return kind === 'ordinance' || kind === 'rule' ? LOCAL_DRAFTING_CHECKS : ADMIN_DRAFTING_CHECKS;
}

export function documentDate(value?: string): string | undefined {
  if (!value || !date.safeParse(value).success) return undefined;
  const [year, month, day] = value.split('-');
  return `${year}. ${Number(month)}. ${Number(day)}.`;
}
