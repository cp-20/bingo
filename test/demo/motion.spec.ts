import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function phase(page: Page, state: "reach" | "bingo" | "reset") {
  await page.evaluate((next) => {
    const room = JSON.parse(localStorage.getItem("bingo-room-demo-v1")!);
    const card = [
      7, 19, 34, 49, 65, 11, 22, 38, 52, 70, 3, 27, 0, 55, 62, 14, 16, 41, 47,
      73, 9, 24, 43, 58, 68,
    ];
    room.guests[0].card = card;
    room.guests[0].name = "営業企画チーム・ビンゴの参加者番号123";
    room.drawn =
      next === "reset" ? [] : card.slice(0, next === "bingo" ? 5 : 4);
    room.status = next === "reset" ? "lobby" : "playing";
    room.guests.forEach(
      (
        guest: { bingoAt: number | null; rank: number | null },
        index: number,
      ) => {
        guest.bingoAt = next === "bingo" && index === 0 ? 5 : null;
        guest.rank = next === "bingo" && index === 0 ? 1 : null;
      },
    );
    if (next === "reset") room.gameNumber++;
    room.prizes =
      next === "bingo"
        ? [
            {
              id: "fixture-prize",
              name: "コーヒーギフト",
              playerId: room.guests[0].id,
            },
          ]
        : [];
    room.revision++;
    localStorage.setItem("bingo-room-demo-v1", JSON.stringify(room));
    window.dispatchEvent(new Event("online"));
  }, state);
}

test("new wins celebrate once, keep the card usable, and respect reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/join/DEMO8888/");
  await phase(page, "reach");
  await expect(page.getByRole("status")).toContainText("65番でビンゴ");
  await expect(page.locator(".celebration")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/participant-reach.png",
    fullPage: true,
  });
  await page.getByText("画面を切り替える", { exact: true }).click();
  await page.getByRole("button", { name: "ビンゴの演出を試す" }).click();
  await expect(page.getByRole("status")).toContainText("1位 おめでとう！");
  await expect(page.locator(".celebration i")).toHaveCount(24);
  await expect(page.locator(".card-numbers .marked")).toHaveCount(5);
  await expect(page.locator(".participant-help")).toContainText(
    "景品の案内をお待ちください",
  );
  await page.getByText("これまでに出た番号を見る", { exact: false }).click();
  await expect(page.locator(".drawn-details")).toHaveAttribute("open", "");
  await page.getByText("これまでに出た番号を見る", { exact: false }).click();
  await page.screenshot({
    path: "test-results/participant-celebration.png",
    fullPage: true,
  });
  await expect(page.locator(".celebration")).toHaveCount(0, { timeout: 4000 });
  await phase(page, "bingo");
  await expect(page.locator(".won-prize")).toContainText("コーヒーギフト");
  const violations = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    violations.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const bounds = await page
      .getByRole("table", { name: "ビンゴカード" })
      .boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.reload();
  await expect(page.getByRole("status")).toContainText("1位 おめでとう！");
  await expect(page.locator(".celebration")).toHaveCount(0);
  await phase(page, "reset");
  await expect(page.locator(".participant-latest")).toContainText(
    "まもなくスタート",
  );
  await expect(page.locator(".card-numbers .marked")).toHaveCount(0);
  await expect(page.locator(".celebration")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await phase(page, "reach");
  await expect(page.getByRole("status")).toContainText("65番でビンゴ");
  await phase(page, "bingo");
  await expect(page.getByRole("status")).toContainText("1位 おめでとう！");
  await expect(page.locator(".celebration")).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((item) => item.playState === "running")
          .length,
    ),
  ).toBe(0);
});

test("the mobile host can keep drawing while checking prizes and cannot draw offline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/host/DEMO8888/");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "最初の番号をひく" }).click();
  const next = page.getByRole("button", { name: "次の番号をひく" });
  await expect(next).toBeEnabled();
  await page
    .getByText("保存・イベント設定", { exact: true })
    .scrollIntoViewIfNeeded();
  const bounds = await next.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  await next.click();
  await expect(page.locator(".draw-control-state")).toContainText("第2回");
  await page.context().setOffline(true);
  await expect(next).toBeDisabled();
  await expect(page.getByText(/再接続中 —/)).toBeVisible();
  await page.context().setOffline(false);
  await expect(next).toBeEnabled();
  await page.screenshot({
    path: "test-results/host-mobile-controls.png",
    fullPage: true,
  });
});

test("the venue fits a long event name and winners while prizes can be handed over", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/screen/DEMO8888/");
  await expect(page.getByAltText("イベント参加用QRコード")).toBeVisible();
  await page.screenshot({
    path: "test-results/screen-lobby-festive.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    const room = JSON.parse(localStorage.getItem("bingo-room-demo-v1")!);
    room.title =
      "営業企画部と開発推進部の合同忘年会・年末感謝ビンゴ大会2026・第十五回東京会場";
    room.status = "playing";
    room.drawn = Array.from({ length: 75 }, (_, i) => i + 1);
    room.guests.forEach(
      (
        guest: { name: string; bingoAt: number; rank: number },
        index: number,
      ) => {
        guest.name =
          "営業企画チーム・ビンゴの参加者番号" + String(index).padStart(3, "0");
        guest.bingoAt = 75;
        guest.rank = 1;
      },
    );
    room.prizes = [
      { id: "coffee-prize", name: "コーヒーギフト", playerId: null },
      { id: "cookie-prize", name: "焼き菓子の詰め合わせ", playerId: null },
    ];
    room.revision++;
    localStorage.setItem("bingo-room-demo-v1", JSON.stringify(room));
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator(".bingo-called .draw-ball-number")).toHaveText(
    "75",
  );
  await expect(page.locator(".winner-spotlights strong")).toHaveCount(4);
  for (const height of [720, 800, 1080]) {
    await page.setViewportSize({ width: 1280, height });
    const board = await page.locator(".venue-footer").boundingBox();
    const winners = await page.locator(".show-winners").boundingBox();
    expect(board!.y + board!.height).toBeLessThanOrEqual(height);
    expect(winners!.y + winners!.height).toBeLessThanOrEqual(height);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".celebration")).toHaveCount(0, { timeout: 4000 });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/screen-playing-festive.png",
    fullPage: true,
  });
  await page.goto("/host/DEMO8888/");
  const selection = page.getByLabel("当選者を選択", { exact: true }).first();
  await selection.selectOption({ index: 1 });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "確定", exact: true }).first().click();
  await expect(page.locator(".awarded")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "確定", exact: true }).first().click();
  await expect(page.locator(".awarded")).toHaveCount(1);
  await expect(page.locator(".awarded")).toContainText(
    "営業企画チーム・ビンゴの参加者番号000",
  );
  await page.screenshot({
    path: "test-results/host-prize-handover.png",
    fullPage: true,
  });
  const guest = await context.newPage();
  await guest.goto("/join/DEMO8888/");
  await expect(guest.locator(".won-prize")).toContainText("コーヒーギフト");
  await expect(guest.locator(".celebration")).toHaveCount(0);
});
