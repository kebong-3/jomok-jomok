import type { Metadata } from 'next';
import localFont from 'next/font/local';
import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/700.css';
import './globals.css';

const ui = localFont({
  src: '../../node_modules/pretendard-gov/dist/web/variable/woff2/PretendardGOVVariable.woff2',
  variable: '--font-ui',
  weight: '45 920',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '조목조목 — 규정 제·개정 도우미',
  description: '개정 의도 한 줄이면, 결재 올릴 문서 한 벌. 조문 수정안·신구조문대비표·개정문·인용 정정·입법예고문을 만드는 규정 제·개정 에이전트',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={ui.variable}>
      <body>{children}</body>
    </html>
  );
}
