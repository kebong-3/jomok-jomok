import type { DocModel } from '@/lib/docs';
import type { Run } from '@/lib/hwpx/build';
import { documentLayout } from '@/lib/document-layout';

function R({ r }: { r: Run }) {
  const cls = [r.underline ? 'ul' : '', r.bold ? 'b' : ''].join(' ').trim();
  if (r.bold || r.size === 'title') return <b className={r.underline ? 'ul' : undefined}>{r.text}</b>;
  return cls ? <span className={cls}>{r.text}</span> : <>{r.text}</>;
}

export default function PaperDoc({ doc }: { doc: DocModel }) {
  const layout = documentLayout(doc.layout);
  return (
    <article className="paper" aria-label={doc.title} style={{ fontFamily: `'${layout.font}', 'Noto Serif KR', serif`, fontSize: `${layout.bodyPt}pt`, lineHeight: layout.linePercent / 100 }}>
      {doc.blocks.map((b, i) => {
        if (b.type === 'p') {
          const title = b.runs[0]?.size === 'title';
          const small = b.runs[0]?.size === 'small';
          const heading = b.runs[0]?.size === 'heading';
          return (
            <p key={i} className={`p ${b.align ?? ''} ${title ? 'title' : ''} ${small ? 'small' : ''}`} style={{ fontSize: `${title ? layout.titlePt : heading ? layout.headingPt : small ? layout.smallPt : layout.bodyPt}pt`, breakBefore: b.pageBreakBefore ? 'page' : undefined }}>
              {b.runs.length ? b.runs.map((r, j) => <R key={j} r={r} />) : ' '}
            </p>
          );
        }
        const [head, ...rows] = b.rows;
        return (
          <table key={i} style={{ fontSize: `${layout.bodyPt}pt`, lineHeight: layout.tableLinePercent / 100 }}>
            <colgroup>{b.widths.map((w, j) => <col key={j} style={{ width: `${(w / b.widths.reduce((s, x) => s + x, 0)) * 100}%` }} />)}</colgroup>
            {head?.head && (
              <thead><tr>{head.cells.map((c, j) => <th key={j}>{c.map((l) => l.map((r) => r.text).join('')).join(' ')}</th>)}</tr></thead>
            )}
            <tbody>
              {(head?.head ? rows : b.rows).map((row, ri) => (
                <tr key={ri}>{row.cells.map((c, ci) => <td key={ci}>{c.map((line, li) => <div className="cl" key={li}>{line.length ? line.map((r, k) => <R key={k} r={r} />) : ' '}</div>)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </article>
  );
}
