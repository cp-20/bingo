import { randomInt } from "node:crypto";

export const FREE_LIMIT = 30;
export const PAID_LIMIT = 300;
export const EVENT_PRICE = 2980;
export type Card = number[];
export type Prize = {
  id: string;
  name: string;
  playerId: string | null;
  imageKey?: string;
  awardId?: string;
  awardedName?: string;
  awardedGame?: number;
  deliveredAt?: number | null;
};
export type Stage = {
  mode: "prize" | "award" | "history";
  prizeId?: string;
} | null;
export type Receipt = {
  id: string;
  prizeId: string;
  prizeName: string;
  imageKey?: string;
  playerId: string;
  playerName: string;
  gameNumber: number;
  claimCode: string;
  deliveredAt: number | null;
};
export type ChatMessage = {
  id: string;
  name: string;
  body: string;
  host: boolean;
  createdAt: number;
};
export type CommunityFeed = {
  revision: number;
  chatEnabled: boolean;
  messages: ChatMessage[];
  pinned: ChatMessage | null;
  reactions: { clap: number; cheer: number; wow: number };
  myReaction?: string;
};
export type Room = {
  id: string;
  title: string;
  status: "lobby" | "playing" | "finished";
  plan: "free" | "event";
  drawn: number[];
  prizes: Prize[];
  createdAt: number;
  expiresAt: number;
  revision: number;
  gameNumber: number;
  stage?: Stage;
  featuredPrizeId?: string | null;
};
export type Player = {
  id: string;
  name: string;
  bingoAt: number | null;
  rank: number | null;
};
export type RoomView = Room & {
  count: number;
  limit: number;
  winners: Player[];
  players?: Player[];
  me?: Player & { card: Card };
  paymentReady?: boolean;
  paymentStatus?: string;
  reachCount?: number;
  receipts?: Receipt[];
  pendingPrizes?: number;
  crewKey?: string;
};

export function makeCard(): Card {
  const columns = Array.from({ length: 5 }, (_, col) => {
    const values = Array.from({ length: 15 }, (_, i) => col * 15 + i + 1);
    for (let i = values.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values.slice(0, 5);
  });
  const card = Array.from(
    { length: 25 },
    (_, i) => columns[i % 5][Math.floor(i / 5)],
  );
  card[12] = 0;
  return card;
}

export { cardStatus } from "./card";

export function nextNumber(drawn: number[]) {
  const used = new Set(drawn);
  const remaining = Array.from({ length: 75 }, (_, i) => i + 1).filter(
    (n) => !used.has(n),
  );
  if (!remaining.length) throw new Error("すべての番号を抽選しました。");
  return remaining[randomInt(remaining.length)];
}

export function cleanName(value: unknown, max = 20) {
  if (typeof value !== "string") throw new Error("名前を入力してください。");
  const name = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!name || [...name].length > max)
    throw new Error(`名前は1〜${max}文字で入力してください。`);
  return name;
}

export function csvCell(value: string | number) {
  const text = String(value);
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
}
