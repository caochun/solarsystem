import { test, expect } from "@playwright/test";

test("ground observatory reports topocentric coordinates for the selected target", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/?body=moon&time=1789041600000");
    await page.locator("#open-observatory").click();
    await expect(page.locator("#observatory-dialog")).toBeVisible();
    await expect(page.locator("#observatory-target")).toContainText("月球");
    await expect(page.locator("#observatory-time-slider")).toBeVisible();
    await expect(page.locator("#observatory-time-label")).toContainText("UTC");
    await page.locator("#observatory-solve").click();
    await expect(page.locator("#observatory-result")).toContainText("方位角");
    await expect(page.locator("#observatory-result")).toContainText("高度角");
    await page.locator("#observatory-capture").click();
    await expect(page.locator("#observatory-image")).toBeVisible();
    await expect(page.locator("#observatory-image-note")).toContainText("模拟图像");
    await expect(page.locator("#observatory-download")).toBeVisible();
    await expect(page.locator("#observatory-fits")).toBeVisible();
    await page.locator("#observatory-site").selectOption("mauna-kea");
    await expect(page.locator("#observatory-lat")).toHaveValue("19.8207");
    await page.locator("#close-observatory").click();
    expect(errors).toEqual([]);
});
