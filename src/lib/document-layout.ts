/** PDF 416–420 (printed 408–412), 자치법규 입안 길라잡이 2026. */
export type DocumentLayout = 'legislation' | 'comparison' | 'support';
export function documentLayout(kind: DocumentLayout = 'support') {
  const legal = kind !== 'support';
  return {
    font: legal ? '신명조' : '함초롬바탕',
    bodyPt: legal ? 14 : 11,
    titlePt: 16,
    headingPt: legal ? 15 : 12,
    smallPt: 10,
    linePercent: kind === 'legislation' ? 230 : kind === 'comparison' ? 180 : 160,
    tableLinePercent: legal ? 180 : 150,
    leftMm: legal ? 25 : 20,
    rightMm: legal ? 25 : 20,
    topMm: legal ? 16 : 20,
    bottomMm: legal ? 16 : 20,
    headerMm: legal ? 12.7 : 10,
    footerMm: legal ? 12.7 : 10,
  };
}
