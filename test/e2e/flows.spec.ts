import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { hash } from "../../src/lib/service";
import { makeCard } from "../../src/lib/game";

async function room(request: APIRequestContext, title: string) {
  const res = await request.post("/api/rooms", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": randomBytes(32).toString("base64url"),
    },
    data: { title },
  });
  expect(res.status()).toBe(201);
  return res.json() as Promise<{ id: string; hostToken: string }>;
}
async function noOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth + 1,
    overflow: [...document.querySelectorAll("main *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        right: Math.round(e.getBoundingClientRect().right),
      }))
      .slice(0, 12),
  }));
  expect(result.fits, JSON.stringify(result.overflow)).toBe(true);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
test("landing works at 320px and desktop; dialog restores keyboard focus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const opener = page
    .getByRole("button", { name: "無料ではじめる", exact: true })
    .first();
  await opener.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("イベント名")).toBeFocused();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(opener).toBeFocused();
  await accessible(page);
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/landing-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/landing-mobile.png",
    fullPage: true,
  });
  await accessible(page);
  expect(errors).toEqual([]);
});
test("host and mobile guest create, join, draw, recover after storage loss, and reconnect", async ({
  page,
  browser,
  request,
}) => {
  const event = await room(request, "みんなで忘年会 2026");
  await page.goto(`/host/${event.id}#key=${event.hostToken}`);
  await expect(
    page.getByRole("heading", { name: "みんなで忘年会 2026", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator(".host-lobby .join-panel")).toBeVisible();
  await noOverflow(page);
  await accessible(page);
  await page.screenshot({
    path: "test-results/host-lobby-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const guest = await guestContext.newPage();
  await guest.goto("http://127.0.0.1:3100/");
  await guest
    .getByLabel("参加コード", { exact: true })
    .fill(
      event.id.slice(0, 4).toLowerCase() +
        " " +
        event.id.slice(4).toLowerCase(),
    );
  await guest.getByRole("button", { name: "参加する", exact: true }).click();
  await guest.getByLabel("会場で表示するニックネーム").fill("ビンゴ太郎");
  await guest.getByRole("button", { name: "ビンゴに参加する" }).click();
  await expect(
    guest.getByRole("table", { name: "ビンゴカード" }),
  ).toBeVisible();
  const card = await guest.getByRole("table").textContent();
  const key = await guest.evaluate(
    (id) => localStorage.getItem(`bingo-player-${id}`),
    event.id,
  );
  expect(key).toHaveLength(43);
  await guest.reload();
  await expect(guest.getByRole("table")).toBeVisible();
  expect(await guest.getByRole("table").textContent()).toBe(card);
  await page.bringToFront();
  const draw = page.getByRole("button", { name: "最初の番号をひく" });
  await expect(draw).toBeEnabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await draw.click();
  await expect(draw).toBeEnabled();
  expect(
    (await (await request.get(`/api/rooms/${event.id}`)).json()).drawn,
  ).toHaveLength(0);
  page.once("dialog", (dialog) => dialog.accept());
  await draw.click();
  await expect(
    page.getByRole("button", { name: "次の番号をひく" }),
  ).toBeEnabled();
  await expect(page.locator(".card-return")).not.toHaveAttribute("open", "");
  await expect(
    page.getByRole("heading", { name: "新規受付は終了しました" }),
  ).toBeHidden();
  await page.context().setOffline(true);
  await expect(
    page.getByRole("button", { name: "次の番号をひく" }),
  ).toBeDisabled();
  await expect(page.getByText(/再接続中 —/)).toBeVisible();
  await page.context().setOffline(false);
  await expect(
    page.getByRole("button", { name: "次の番号をひく" }),
  ).toBeEnabled();
  await accessible(page);
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/host-desktop.png",
    fullPage: true,
  });
  const drawBounds = await page
    .getByRole("button", { name: "次の番号をひく" })
    .boundingBox();
  expect(drawBounds!.y + drawBounds!.height).toBeLessThanOrEqual(800);
  await page.setViewportSize({ width: 1280, height: 720 });
  const shortBounds = await page
    .getByRole("button", { name: "次の番号をひく" })
    .boundingBox();
  expect(shortBounds!.y + shortBounds!.height).toBeLessThanOrEqual(720);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setViewportSize({ width: 320, height: 800 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/host-mobile.png",
    fullPage: true,
  });
  await guest.bringToFront();
  await expect(guest.locator(".participant-latest")).toContainText(
    "1 / 75 回目",
  );
  await accessible(guest);
  await noOverflow(guest);
  for (const width of [320, 390]) {
    await guest.setViewportSize({ width, height: 800 });
    await expect(guest.getByRole("cell")).toHaveCount(25);
    const cardBounds = await guest.getByRole("table").boundingBox();
    const callBounds = await guest.locator(".participant-latest").boundingBox();
    expect(callBounds!.y + callBounds!.height).toBeLessThan(cardBounds!.y);
    expect(cardBounds!.y + cardBounds!.height).toBeLessThanOrEqual(800);
    await noOverflow(guest);
  }
  await guest.screenshot({
    path: "test-results/card-mobile.png",
    fullPage: true,
  });
  const restored = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const cardPage = await restored.newPage();
  await cardPage.goto(`http://127.0.0.1:3100/join/${event.id}#card=${key}`);
  await expect(cardPage.getByRole("table")).toBeVisible();
  expect(await cardPage.getByRole("table").textContent()).toBe(card);
  expect(new URL(cardPage.url()).hash).toBe("");
  await guestContext.close();
  await restored.close();
});
test("a lost join response reuses the same card; first draw cannot multiply participants", async ({
  browser,
  request,
}) => {
  const event = await room(request, "再接続のテスト");
  const context = await browser.newContext();
  const page = await context.newPage();
  let lost = false;
  await page.route(`**/api/rooms/${event.id}/join`, async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await context.clearCookies();
      await route.abort();
    } else await route.continue();
  });
  await page.goto(`http://127.0.0.1:3100/join/${event.id}`);
  await page.getByLabel("会場で表示するニックネーム").fill("Alice");
  await page.getByRole("button", { name: "ビンゴに参加する" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  const response = await request.get(`/api/rooms/${event.id}`);
  expect((await response.json()).count).toBe(1);
  await context.close();
});
test("projector and print views are readable and do not expose host credentials", async ({
  page,
  request,
}) => {
  const event = await room(request, "会場スクリーン");
  await page.goto(`/screen/${event.id}`);
  await expect(
    page.getByRole("heading", { name: "会場スクリーン", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/screen-desktop.png",
    fullPage: true,
  });
  await expect(page.locator(".screen-address")).toHaveText(
    "http://127.0.0.1:3100",
  );
  expect(await page.content()).not.toContain(event.hostToken);
  const joined = await request.post(`/api/rooms/${event.id}/join`, {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      name: "印刷する参加者",
      joinKey: randomBytes(32).toString("base64url"),
    },
  });
  expect(joined.status()).toBe(200);
  await page.goto(`/host/${event.id}/print#key=${event.hostToken}`);
  await expect(page.getByRole("table", { name: "ビンゴカード" })).toBeVisible();
  await accessible(page);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-header")).toBeHidden();
  await expect(page.getByRole("table")).toBeVisible();
});
test("300 participants can poll at the planned rate while the host draws", async ({
  request,
}) => {
  const event = await room(request, "300人のローカル負荷確認");
  const store = createClient({ url: process.env.BINGO_QA_DATABASE_URL! });
  const keys = Array.from({ length: 300 }, () =>
    randomBytes(32).toString("base64url"),
  );
  try {
    await store.batch(
      [
        {
          sql: "UPDATE rooms SET plan='event',revision=revision+1 WHERE id=?",
          args: [event.id],
        },
        ...keys.map((key, i) => ({
          sql: "INSERT INTO players(id,room_id,auth_hash,name,name_key,card,joined_at) VALUES(?,?,?,?,?,?,?)",
          args: [
            randomUUID(),
            event.id,
            hash(key),
            `Guest ${i}`,
            `guest ${i}`,
            JSON.stringify(makeCard()),
            Date.now(),
          ],
        })),
      ],
      "write",
    );
    const started = performance.now(),
      timings: number[] = [],
      revisions: (number | undefined)[] = Array(300);
    let failures = 0,
      inFlight = 0,
      index = 0,
      draws = 0;
    const pending: Promise<unknown>[] = [];
    for (let tick = 0; tick < 620; tick++) {
      if (inFlight < 16) {
        const client = index++ % 300,
          begin = performance.now();
        inFlight++;
        pending.push(
          fetch(
            `http://127.0.0.1:3100/api/rooms/${event.id}?view=card${revisions[client] ? `&revision=${revisions[client]}` : ""}`,
            {
              headers: { "X-Player-Key": keys[client] },
              signal: AbortSignal.timeout(5000),
            },
          )
            .then(async (response) => {
              if (response.status === 200) {
                const view = await response.json();
                expect(view.me.name).toBe(`Guest ${client}`);
                expect(view.winners).toEqual([]);
                revisions[client] = view.revision;
              } else if (response.status !== 204) failures++;
              timings.push(performance.now() - begin);
            })
            .catch(() => failures++)
            .finally(() => inFlight--),
        );
      }
      if (tick > 0 && tick % 150 === 0) {
        const result = await request.post(`/api/rooms/${event.id}/action`, {
          headers: {
            Origin: "http://127.0.0.1:3100",
            Authorization: `Bearer ${event.hostToken}`,
          },
          data: {
            action: "draw",
            expectedGameNumber: 1,
            expectedDrawCount: draws,
          },
        });
        expect(result.status()).toBe(200);
        draws++;
      }
      await delay(16);
    }
    await Promise.all(pending);
    timings.sort((a, b) => a - b);
    const summary = {
      participants: 300,
      requests: timings.length,
      failures,
      p95Ms: Math.round(timings[Math.floor(timings.length * 0.95)]),
      maxMs: Math.round(timings.at(-1)!),
      seconds: Math.round((performance.now() - started) / 1000),
      draws,
    };
    writeFileSync("test-results/load.json", JSON.stringify(summary, null, 2));
    expect(failures).toBe(0);
    expect(timings.length).toBeGreaterThanOrEqual(500);
    expect(summary.p95Ms).toBeLessThan(1000);
  } finally {
    store.close();
  }
});

test("a full venue keeps the called number visible and lets the host find long names", async ({
  page,
  request,
}) => {
  const event = await room(
    request,
    "営業企画部と開発推進部の合同忘年会・年末感謝ビンゴ大会2026・第十五回東京会場",
  );
  const store = createClient({ url: process.env.BINGO_QA_DATABASE_URL! });
  try {
    await store.batch(
      [
        {
          sql: "UPDATE rooms SET plan='event',status='playing',drawn=?,revision=revision+1 WHERE id=?",
          args: [
            JSON.stringify(Array.from({ length: 75 }, (_, i) => i + 1)),
            event.id,
          ],
        },
        ...Array.from({ length: 300 }, (_, i) => ({
          sql: "INSERT INTO players(id,room_id,auth_hash,name,name_key,card,bingo_at,joined_at) VALUES(?,?,?,?,?,?,?,?)",
          args: [
            randomUUID(),
            event.id,
            hash(randomBytes(32).toString("base64url")),
            "営業企画チーム・ビンゴの参加者番号" + String(i).padStart(3, "0"),
            "guest-" + i,
            JSON.stringify(makeCard()),
            75,
            Date.now() + i,
          ],
        })),
      ],
      "write",
    );
  } finally {
    store.close();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/screen/" + event.id);
  await expect(page.locator(".screen-draw .draw-ball-number")).toHaveText("75");
  await expect(page.locator(".screen-winners")).toContainText("300人がビンゴ");
  await expect(page.locator(".screen-winner-names b")).toHaveCount(6);
  await expect(page.locator(".number-band>div>span")).toHaveCount(75);
  await expect(page.getByAltText("イベント参加用QRコード")).toBeHidden();
  for (const height of [720, 800, 1080]) {
    await page.setViewportSize({ width: 1280, height });
    const bounds = await page.locator(".number-board").boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    const winnerBounds = await page.locator(".screen-winners").boundingBox();
    expect(winnerBounds!.y + winnerBounds!.height).toBeLessThanOrEqual(height);
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await accessible(page);
  await page.screenshot({
    path: "test-results/screen-playing.png",
    fullPage: true,
  });
  await page.goto("/host/" + event.id + "#key=" + event.hostToken);
  await expect(page.locator(".big-number .draw-ball-number")).toHaveText("75");
  await page.locator(".participant-register>summary").click();
  await page.getByLabel("参加者名で検索").fill("299");
  await expect(page.locator(".player-row")).toHaveCount(1);
  await expect(page.locator(".player-row")).toContainText("299");
  await page.setViewportSize({ width: 320, height: 800 });
  await noOverflow(page);
  await accessible(page);
});

test("reach, bingo and prize states keep a long-named guest's full card readable", async ({
  page,
  request,
}) => {
  const event = await room(request, "スマホでの景品受け取り");
  const key = randomBytes(32).toString("base64url"),
    playerId = randomUUID();
  const card = [
    7, 19, 34, 49, 65, 11, 22, 38, 52, 70, 3, 27, 0, 55, 62, 14, 16, 41, 47, 73,
    9, 24, 43, 58, 68,
  ];
  const drawn = card.slice(0, 4);
  const store = createClient({ url: process.env.BINGO_QA_DATABASE_URL! });
  try {
    await store.batch(
      [
        {
          sql: "UPDATE rooms SET status='playing',drawn=?,revision=revision+1 WHERE id=?",
          args: [JSON.stringify(drawn), event.id],
        },
        {
          sql: "INSERT INTO players(id,room_id,auth_hash,name,name_key,card,joined_at) VALUES(?,?,?,?,?,?,?)",
          args: [
            playerId,
            event.id,
            hash(key),
            "営業企画チーム・ビンゴの参加者番号123",
            "long-name",
            JSON.stringify(card),
            Date.now(),
          ],
        },
      ],
      "write",
    );
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/join/" + event.id + "#card=" + key);
    await expect(page.getByRole("status")).toContainText("リーチ！ あと1つ");
    await expect(page.locator(".card-numbers .marked")).toHaveCount(4);
    await accessible(page);
    await noOverflow(page);
    drawn.push(card[4]);
    await store.batch(
      [
        {
          sql: "UPDATE rooms SET drawn=?,prizes=?,revision=revision+1 WHERE id=?",
          args: [
            JSON.stringify(drawn),
            JSON.stringify([
              { id: randomUUID(), name: "コーヒーギフト", playerId },
            ]),
            event.id,
          ],
        },
        { sql: "UPDATE players SET bingo_at=5 WHERE id=?", args: [playerId] },
      ],
      "write",
    );
    await expect(page.getByRole("status")).toContainText("1位 おめでとう！");
    await expect(page.locator(".won-prize")).toContainText("コーヒーギフト");
    await expect(page.locator(".card-numbers .marked")).toHaveCount(5);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const bounds = await page
        .getByRole("table", { name: "ビンゴカード" })
        .boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
      await noOverflow(page);
    }
    await accessible(page);
    await page.screenshot({
      path: "test-results/card-bingo.png",
      fullPage: true,
    });
  } finally {
    store.close();
  }
});
