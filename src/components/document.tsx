import Link from "next/link";
import { Footer, Logo } from "./ui";
export default function Document({
  title,
  children,
}: {
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="document-header">
        <Logo />
        <Link href="/" className="text-link">
          ホームへ戻る
        </Link>
      </header>
      <main id="main-content" className="document">
        <h1>{title}</h1>
        {children}
      </main>
      <Footer />
    </>
  );
}
