import type { Card } from "./game";
const lines = [
  ...Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => row * 5 + col),
  ),
  ...Array.from({ length: 5 }, (_, col) =>
    Array.from({ length: 5 }, (_, row) => row * 5 + col),
  ),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];
export function cardStatus(card: Card, drawn: number[]) {
  const marked = new Set([0, ...drawn]);
  const missing = lines.map((line) =>
    line.filter((index) => !marked.has(card[index])),
  );
  return {
    bingo: missing.some((line) => line.length === 0),
    reach: missing.filter((line) => line.length === 1).length,
    needed: [
      ...new Set(
        missing
          .filter((line) => line.length === 1)
          .map((line) => card[line[0]]),
      ),
    ].sort((a, b) => a - b),
  };
}
