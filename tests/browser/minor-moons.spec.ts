import { test, expect } from "@playwright/test";

test("minor moons are searchable, selectable, linked and navigable", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?time=1788998400000");
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    await expect(page.locator(".body-card")).toHaveCount(152);
    await page.locator("#body-filter").selectOption("jupiter");
    await expect(page.locator(".body-card:visible")).toHaveCount(48);
    await page.locator("#body-search").fill("Himalia");
    await page.locator('[data-minor-moon="himalia"]').click();
    await expect(page.locator("#body-name")).toHaveText("Himalia");
    await expect(page.locator("#parent-body")).toHaveText("返回木星 ↗");
    await expect(page.locator("#body-orbit-period")).toContainText("天");
    await expect
        .poll(() => new URL(page.url()).searchParams.get("moon"))
        .toBe("himalia");
    await page.locator("#parent-body").click();
    await expect(page.locator("#body-name")).toHaveText("木星");
});

test("minor moon deep links load without catalog API requests and tour restores selection", async ({
    page,
}) => {
    const apiRequests: string[] = [];
    page.on("request", (request) => {
        if (request.url().includes("/api/catalog/object/"))
            apiRequests.push(request.url());
    });
    await page.goto("/?moon=himalia&time=1788998400000");
    await expect(page.locator("#body-name")).toHaveText("Himalia");
    expect(apiRequests).toEqual([]);
    await page.locator("#start-tour").click();
    await expect(page.locator("#solar-tour")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#body-name")).toHaveText("Himalia");
});
