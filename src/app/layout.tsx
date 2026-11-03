import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "BINGO ROOM｜集まったら、ビンゴしよう。",
    template: "%s｜BINGO ROOM",
  },
  description:
    "QRコードで参加できるイベント用ビンゴ。30人まで無料、最大300人のイベントは2,980円。カード自動反映・同着判定・景品管理・会場スクリーンに対応。",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#164c3d",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
