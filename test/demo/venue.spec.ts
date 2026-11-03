import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("the sample venue showcases real photos, pins one comment and returns from a show to the next draw", async ({
  page,
  context,
}) => {
  await page.goto("/host/DEMO8888/");
  await expect(page.locator(".prize-row img")).toHaveCount(3);
  const screen = await context.newPage();
  await screen.setViewportSize({ width: 1280, height: 720 });
  await screen.goto("/screen/DEMO8888/");
  await page
    .getByRole("button", { name: "この景品をスクリーンに紹介" })
    .last()
    .click();
  await expect(screen.locator(".show-prize h2")).toHaveText("お肉のごちそう便");
  await expect(screen.locator(".show-photo img")).toBeVisible();
  await page
    .getByRole("button", { name: "スクリーンに映す", exact: true })
    .first()
    .click();
  await expect(screen.locator(".screen-comment")).toContainText(
    "お肉のギフト、狙ってます！",
  );
  for (const height of [720, 800, 1080]) {
    await screen.setViewportSize({ width: 1280, height });
    const footer = await screen.locator(".venue-footer").boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(height + 1);
    expect(
      await screen.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await screen.setViewportSize({ width: 1280, height: 720 });
  await screen.screenshot({ path: "test-results/venue-prize-photo.png" });
  const a = await new AxeBuilder({ page: screen })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    a.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "最初の番号をひく" }).click();
  await expect(screen.locator(".show-draw")).toBeVisible();
  await expect(screen.locator(".show-prize")).toHaveCount(0);
  await screen.screenshot({ path: "test-results/venue-called-number.png" });
  await page.getByRole("button", { name: "番号一覧を映す" }).click();
  await expect(screen.locator(".number-band>div>span")).toHaveCount(75);
  await page.getByRole("button", { name: "次の番号をひく" }).click();
  await expect(screen.locator(".show-draw")).toBeVisible();
  await expect(screen.locator(".number-board")).toHaveCount(0);
});

test("the demo role switch opens the staff view without a separate credential setup", async ({
  page,
}) => {
  await page.goto("/host/DEMO8888/");
  await page.getByText("画面を切り替える", { exact: true }).click();
  await page.getByRole("link", { name: "景品係", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "受け渡し待ち 0" }),
  ).toBeVisible();
  await expect(
    page.getByText("幹事から景品係用リンクを受け取ってください。", {
      exact: true,
    }),
  ).toHaveCount(0);
});
