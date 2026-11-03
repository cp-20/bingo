import test from "node:test";
import assert from "node:assert/strict";
import {
  makeCard,
  cardStatus,
  nextNumber,
  cleanName,
  csvCell,
} from "../src/lib/game";

test("cards follow the B/I/N/G/O ranges and keep a free center", () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const card = makeCard();
    assert.equal(card.length, 25);
    assert.equal(card[12], 0);
    assert.equal(new Set(card).size, 25);
    card.forEach((n, i) => {
      if (i !== 12) assert.ok(n >= (i % 5) * 15 + 1 && n <= ((i % 5) + 1) * 15);
    });
    assert.equal(cardStatus(card, []).bingo, false);
    assert.equal(
      cardStatus(
        card,
        Array.from({ length: 75 }, (_, i) => i + 1),
      ).bingo,
      true,
    );
  }
});
test("all row, column, and diagonal wins are recognized; near misses stay reach", () => {
  const card = makeCard();
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
  for (const line of lines) {
    const values = line.map((i) => card[i]).filter(Boolean);
    assert.equal(cardStatus(card, values).bingo, true);
    const near = cardStatus(card, values.slice(1));
    assert.equal(near.bingo, false);
    assert.ok(near.reach > 0);
  }
});
test("75 draws never repeat and the 76th draw is rejected", () => {
  const drawn: number[] = [];
  for (let i = 0; i < 75; i++) drawn.push(nextNumber(drawn));
  assert.equal(new Set(drawn).size, 75);
  assert.throws(() => nextNumber(drawn));
});
test("reach identifies the actual uncalled numbers without repeating the free square", () => {
  const card = [
    7, 19, 34, 49, 65, 11, 22, 38, 52, 70, 3, 27, 0, 55, 62, 14, 16, 41, 47, 73,
    9, 24, 43, 58, 68,
  ];
  const near = cardStatus(card, [7, 19, 34, 49]);
  assert.equal(near.bingo, false);
  assert.deepEqual(near.needed, [65]);
  const complete = cardStatus(card, [7, 19, 34, 49, 65]);
  assert.equal(complete.bingo, true);
  assert.ok(!complete.needed.includes(0));
  assert.equal(new Set(complete.needed).size, complete.needed.length);
});
test("names normalize safely and CSV cells cannot start spreadsheet formulas", () => {
  assert.equal(cleanName("  Ａｌｉｃｅ\n "), "Alice");
  assert.throws(() => cleanName(null));
  assert.throws(() => cleanName("x".repeat(21)));
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
  assert.equal(csvCell('a"b,c'), '"a""b,c"');
});
