import Link from "next/link";
import { Logo } from "@/components/ui";
export default function NotFound() {
  return (
    <main className="simple-page">
      <Logo />
      <span className="eyebrow">ROOM NOT FOUND</span>
      <h1>
        ここには、まだ
        <br />
        会場がないようです。
      </h1>
      <p>参加コードやURLを確認してください。</p>
      <Link href="/" className="button primary">
        ホームへ戻る →
      </Link>
    </main>
  );
}
