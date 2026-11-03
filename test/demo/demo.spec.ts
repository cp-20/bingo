import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("the actual screens run locally, share draws across tabs, preserve cards, and make no API requests", async ({
  page,
  context,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  context.on("request", (request) => {
    if (
      request.url().includes("/api/") ||
      !request.url().startsWith("http://127.0.0.1:4173/")
    )
      requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/host/DEMO8888/");
  await expect(
    page.getByRole("button", { name: "最初の番号をひく" }),
  ).toBeEnabled();
  await expect(page.getByText("体験デモ", { exact: true })).toBeVisible();
  const guest = await context.newPage();
  await guest.goto("/");
  await guest.getByText("画面を切り替える", { exact: true }).click();
  await guest.getByRole("link", { name: "参加者", exact: true }).click();
  await expect(
    guest.getByRole("table", { name: "ビンゴカード" }),
  ).toBeVisible();
  const card = await guest.getByRole("table").textContent();
  await page.bringToFront();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "最初の番号をひく" }).click();
  await expect(
    page.getByRole("button", { name: "次の番号をひく" }),
  ).toBeEnabled();
  await guest.bringToFront();
  await expect(guest.locator(".participant-latest")).toContainText(
    "1 / 75 回目",
  );
  await guest.reload();
  expect(await guest.getByRole("table").textContent()).toBe(card);
  const result = await new AxeBuilder({ page: guest })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await guest.setViewportSize({ width: 320, height: 800 });
  expect(
    await guest.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const bounds = await guest
    .getByRole("table", { name: "ビンゴカード" })
    .boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
  await guest.screenshot({
    path: "test-results/demo-participant.png",
    fullPage: true,
  });
  await page.bringToFront();
  await page.screenshot({ path: "test-results/demo-host.png", fullPage: true });
  await page.goto("/screen/DEMO8888/");
  await expect(
    page.locator(".number-spotlight .draw-ball-number"),
  ).not.toHaveText("?");
  const screen = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(screen.violations.map((v) => v.id)).toEqual([]);
  await page.goto("/host/DEMO8888/print/");
  await expect(page.getByRole("table")).toHaveCount(6);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
test("reset and all 75 draws are consistent with the shared bingo rules", async ({
  page,
}) => {
  await page.goto("/host/DEMO8888/");
  page.once("dialog", (dialog) => dialog.accept());
  for (let i = 0; i < 75; i++)
    await page
      .getByRole("button", {
        name: i === 0 ? "最初の番号をひく" : "次の番号をひく",
      })
      .click();
  await expect(page.locator(".number-board .hit")).toHaveCount(75);
  await expect(
    page.locator(".stats-grid>div").nth(2).locator("strong"),
  ).toHaveText("6人");
  await page.getByText("保存・イベント設定", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /次のゲームへ/ }).click();
  await expect(page.locator(".event-status")).toContainText("第2ゲーム");
  await expect(page.locator(".number-board .hit")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "最初の番号をひく" }),
  ).toBeEnabled();
});
