import { test, expect, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
const origin = "http://127.0.0.1:3100";
test("MC, a chatting participant, projector and prize staff complete one event together", async ({
  page,
  browser,
  request,
}) => {
  const created = await request.post("/api/rooms", {
    headers: {
      Origin: origin,
      "Idempotency-Key": randomBytes(32).toString("base64url"),
    },
    data: { title: "営業部 忘年会のビンゴ" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const playerKey = randomBytes(32).toString("base64url");
  const joined = await request.post(`/api/rooms/${event.id}/join`, {
    headers: { Origin: origin },
    data: { name: "さくら", joinKey: playerKey },
  });
  expect(joined.status()).toBe(200);
  const playerId = (await joined.json()).room.me.id;
  const guestContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    guest = await guestContext.newPage(),
    screenContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    }),
    screen = await screenContext.newPage();
  let crewContext: BrowserContext | undefined;
  try {
    await page.goto(`/host/${event.id}#key=${event.hostToken}`);
    await guest.goto(`${origin}/join/${event.id}#card=${playerKey}`);
    await screen.goto(`${origin}/screen/${event.id}`);
    await page.getByLabel("景品名", { exact: true }).fill("コーヒーギフト");
    await page.getByRole("button", { name: "景品を追加", exact: true }).click();
    const photo = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#905d35" },
    })
      .png()
      .toBuffer();
    await page
      .getByLabel("コーヒーギフトの写真", { exact: true })
      .setInputFiles({
        name: "coffee.png",
        mimeType: "image/png",
        buffer: photo,
      });
    await expect(
      page.getByRole("button", { name: "写真を変更", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "この景品をスクリーンに紹介" })
      .click();
    await expect(screen.locator(".show-prize h2")).toHaveText("コーヒーギフト");
    await expect(screen.locator(".show-photo img")).toBeVisible();
    await guest.getByRole("button", { name: /みんなの声/ }).click();
    const input = guest.getByLabel("みんなへメッセージ", { exact: true });
    await input.fill("コーヒー、当たるといいな！");
    await guest.getByRole("button", { name: "送信", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(page.locator(".chat-messages")).toContainText(
      "コーヒー、当たるといいな！",
    );
    await expect(screen.locator(".screen-comment")).not.toContainText(
      "コーヒー、当たるといいな！",
    );
    await page
      .getByRole("button", { name: "スクリーンに映す", exact: true })
      .click();
    await expect(screen.locator(".screen-comment")).toContainText(
      "コーヒー、当たるといいな！",
    );
    await input.fill("まだ入力している途中です");
    await input.evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(3, 3),
    );
    const card = [
        7, 19, 34, 49, 65, 11, 22, 38, 52, 70, 3, 27, 0, 55, 62, 14, 16, 41, 47,
        73, 9, 24, 43, 58, 68,
      ],
      store = createClient({ url: process.env.BINGO_QA_DATABASE_URL! });
    try {
      await store.batch(
        [
          {
            sql: "UPDATE players SET card=? WHERE id=?",
            args: [JSON.stringify(card), playerId],
          },
          {
            sql: "UPDATE rooms SET drawn=?,status='playing',stage='null',revision=revision+1 WHERE id=?",
            args: [JSON.stringify(card.slice(0, 4)), event.id],
          },
        ],
        "write",
      );
      await expect(guest.locator(".chat-game-state")).toContainText(
        "65番でビンゴ",
      );
      await store.batch(
        [
          { sql: "UPDATE players SET bingo_at=5 WHERE id=?", args: [playerId] },
          {
            sql: "UPDATE rooms SET drawn=?,revision=revision+1 WHERE id=?",
            args: [JSON.stringify(card.slice(0, 5)), event.id],
          },
        ],
        "write",
      );
    } finally {
      store.close();
    }
    await expect(guest.locator(".chat-game-state")).toContainText(
      "ビンゴ！ 1位",
    );
    await expect(input).toHaveValue("まだ入力している途中です");
    expect(
      await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart),
    ).toBe(3);
    await expect(screen.locator(".winner-spotlights strong")).toContainText(
      "さくら",
    );
    await page
      .getByLabel("当選者を選択", { exact: true })
      .selectOption(playerId);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "確定", exact: true }).click();
    await expect(screen.locator(".award-spotlight h2")).toContainText("さくら");
    await expect(
      guest.getByRole("button", { name: /景品が決まりました/ }),
    ).toBeVisible();
    await guest.getByRole("button", { name: /景品が決まりました/ }).click();
    await expect(guest.locator(".claim-code")).toBeVisible();
    const claim = (await guest.locator(".claim-code").innerText()).trim();
    expect(await screen.content()).not.toContain(claim);
    const hostView = await (
      await request.get(`/api/rooms/${event.id}`, {
        headers: { Authorization: `Bearer ${event.hostToken}` },
      })
    ).json();
    crewContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const crew = await crewContext.newPage();
    await crew.goto(`${origin}/crew/${event.id}#key=${hostView.crewKey}`);
    await crew.getByLabel("さくらさんの受け取り番号").fill("000000");
    await crew
      .getByRole("button", { name: "受け渡しを確定", exact: true })
      .click();
    await expect(crew.locator(".error[role=alert]")).toContainText("6桁");
    await crew.getByLabel("さくらさんの受け取り番号").fill(claim);
    await crew
      .getByRole("button", { name: "受け渡しを確定", exact: true })
      .click();
    await expect(crew.locator(".handover-confirmed")).toContainText(
      "さくらさんの「コーヒーギフト」の受け渡しを確定",
    );
    await expect(guest.locator(".won-prize")).toContainText("受け取り済み");
    await guest.screenshot({
      path: "test-results/venue-guest-receipt.png",
      fullPage: true,
    });
    await screen.screenshot({ path: "test-results/venue-award.png" });
    await crew.screenshot({
      path: "test-results/venue-crew.png",
      fullPage: true,
    });
    for (const target of [guest, screen, crew]) {
      const a = await new AxeBuilder({ page: target })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        a.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
    await page.getByText("保存・イベント設定", { exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "次のゲームへ ↻", exact: true })
      .click();
    await expect(guest.locator(".won-prize")).toContainText("受け取り済み");
    await expect(page.locator(".prize-row .awarded")).toContainText("さくら");
    await crew.close();
  } finally {
    await guestContext.close();
    await screenContext.close();
    await crewContext?.close();
  }
});
