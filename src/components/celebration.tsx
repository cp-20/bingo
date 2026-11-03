"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";

// Celebrate a new result, never a restored card or a poll with the same result.
export function useCelebration(game: number, winners: number) {
  const previous = useRef({ game, winners });
  const sequence = useRef(0);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    const before = previous.current;
    previous.current = { game, winners };
    if (before.game !== game || winners < before.winners) {
      setBurst(0);
      return;
    }
    if (winners <= before.winners) return;
    setBurst(++sequence.current);
    const timer = setTimeout(() => setBurst(0), 2600);
    return () => clearTimeout(timer);
  }, [game, winners]);
  return burst;
}

export function Celebration({ burst }: { burst: number }) {
  if (!burst) return null;
  return (
    <div className="celebration" key={burst} aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => (
        <i
          key={index}
          style={
            {
              "--x": `${(index * 43 + 7) % 100}vw`,
              "--drift": `${((index * 37) % 150) - 75}px`,
              "--delay": `${(index % 6) * 45}ms`,
              "--turn": `${index % 2 ? 450 : -450}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
