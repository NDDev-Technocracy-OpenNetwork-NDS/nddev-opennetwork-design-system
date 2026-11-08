import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";

for (const theme of ["light", "dark", "light-contrast", "dark-contrast"]) {
  for (const width of [390, 1440]) {
    test(`${theme} at ${width}: components, fonts, accessibility and layout`, async ({
      page,
    }) => {
      const failures: string[] = [];
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 400)
          failures.push(`${response.status()}: ${response.url()}`);
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.getByLabel("Theme", { exact: true }).selectOption(theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await expect(page.locator(".ref-component")).toHaveCount(33);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      await mkdir(".build/visual", { recursive: true });
      await page.screenshot({
        path: `.build/visual/${theme}-${width}-overview.png`,
      });
      await page.locator("#component-button").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `.build/visual/${theme}-${width}-controls.png`,
      });
      await page.getByLabel("Motion", { exact: true }).selectOption("reduced");
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--duration-ui")
            .trim(),
        ),
      ).toBe("0ms");
      expect(failures).toEqual([]);
    });
  }
}

test("native keyboard patterns and explicit context selection", async ({
  page,
}) => {
  await page.goto("/");
  const tabs = page.locator("#component-tabs [role=tab]");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  const trigger = page.locator("[data-open-dialog]").first();
  await trigger.click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByLabel("Density", { exact: true }).selectOption("compact");
  await page.getByLabel("Platform", { exact: true }).selectOption("desktop");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute(
    "data-platform",
    "desktop",
  );
});
