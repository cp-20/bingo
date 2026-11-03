"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="simple-page">
      <span className="eyebrow">LET’S TRY AGAIN</span>
      <h1>うまくつながらなかったようです。</h1>
      <p>少し待ってから、もう一度お試しください。</p>
      <button className="button primary" onClick={reset}>
        再読み込み →
      </button>
    </main>
  );
}
