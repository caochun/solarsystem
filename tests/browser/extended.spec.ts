import { test, expect, type Page } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";

function trackErrors(page: Page) {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", (response) => {
        if (response.status() >= 400) errors.push(response.url());
    });
    return errors;
}

async function renderedFrame(page: Page) {
    await expect(page.locator("#viewport")).toHaveAttribute(
        "data-camera-state",
        "idle",
    );
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                );
            }),
    );
}

test("Extended bodies filter and navigate to parent families, with models loaded on demand", async ({
    page,
}) => {
    const errors = trackErrors(page);
    const models = new Set<string>();
    page.on("response", (response) => {
        if (response.ok() && response.url().endsWith(".glb"))
            models.add(new URL(response.url()).pathname);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?body=jupiter&view=family&time=1788998400000");
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    await expect(page.locator("#view-title")).toHaveText("木星与卫星系统");
    expect([...models]).toEqual([]);
    await page.screenshot({ path: "test-results/jupiter-family.png" });
    await page.locator("#body-filter").selectOption("dwarf");
    await expect(page.locator("[data-body]:visible")).toHaveCount(5);
    await page.locator("#body-search").fill("Pluto");
    await expect(page.locator("[data-body]:visible")).toHaveCount(1);
    await page.locator('[data-body="pluto"]').click();
    await expect(page.locator("#body-name")).toHaveText("冥王星");
    await renderedFrame(page);
    await page.screenshot({ path: "test-results/pluto-desktop.png" });
    await page.locator("#family-view").click();
    await page.reload();
    await expect(page.locator("#view-title")).toHaveText("冥王星与卫星系统");
    await page.locator('[data-body="nix"]').click();
    await expect(page.locator("#body-radius")).toHaveText("18");
    await expect(page.locator("#body-radius-title")).toHaveText("平均半径估计");
    await expect(page.locator("#physical-source")).toContainText("18 ± 1 km");
    await expect(page.locator("#body-radius + small")).toBeVisible();
    await expect(page.locator("#distance-title")).toHaveText("距冥王星");
    await page.locator("#parent-body").click();
    await expect(page.locator("#body-name")).toHaveText("冥王星");
    await page.locator("#body-filter").selectOption("satellite");
    await expect(page.locator("[data-body]:visible")).toHaveCount(27);
    await page.locator("#body-search").fill("海卫一");
    await page.locator('[data-body="triton"]').click();
    await expect(page.locator("#body-radius")).toHaveText("1,352.6");
    await expect(page.locator("#distance-title")).toHaveText("距海王星");
    await expect(page.locator("#body-source")).toContainText("SPICE 历元");
    await page.locator("#body-search").fill("Phobos");
    await page.locator('[data-body="phobos"]').click();
    await expect.poll(() => models.has("/models/phobos.glb")).toBe(true);
    await expect(page.locator("#distance-value")).toHaveText(/9,\d{3} km/);
    await page.locator("#parent-body").click();
    await page.locator("#family-view").click();
    await expect.poll(() => models.has("/models/deimos.glb")).toBe(true);
    expect([...models].sort()).toEqual([
        "/models/deimos.glb",
        "/models/phobos.glb",
    ]);
    await page.locator('[data-body="phobos"]').click();
    await renderedFrame(page);
    await page.screenshot({ path: "test-results/phobos-model.png" });
    expect(errors).toEqual([]);
});

test("Full catalog downloads, sampled searches, cloud rendering and links work", async ({
    page,
}) => {
    const errors = trackErrors(page);
    await page.goto("/?body=sun&view=system&time=1788998400000");
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    await page.locator("#catalog-shortcut").click();
    await expect(page.locator("#catalog-dialog")).toBeVisible();
    await expect(page.locator("#catalog-category option")).toHaveCount(16);
    await expect(page.locator("#catalog-summary")).toContainText(
        "1,365,050 条记录",
    );
    await page.locator("#small-bodies").check();
    await expect(page.locator("#catalog-status")).toContainText(
        "3,004 个抽样点",
    );
    await page.locator("#catalog-overview").click();
    await expect(page.locator("#view-title")).toHaveText("太阳系总览");
    await expect(page.locator("#catalog-dialog")).toBeHidden();
    await expect
        .poll(() => new URL(page.url()).searchParams.get("catalog"))
        .toBe("main_belt_asteroid");
    await page.screenshot({ path: "test-results/main-belt-cloud.png" });
    await page.reload();
    await page.locator("#catalog-shortcut").click();
    await expect(page.locator("#small-bodies")).toBeChecked();
    await page.locator("#catalog-category").selectOption("halley-type_comet");
    await expect(page.locator("#catalog-status")).toContainText("110 个抽样点");
    await page.locator("#catalog-search").fill("Halley");
    await expect(page.locator("#catalog-object option")).toHaveCount(1);
    await expect(page.locator("#catalog-object")).toContainText("1P/Halley");
    await expect(page.locator("#catalog-object-info")).toContainText("历元");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#catalog-download").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("halley-type_comet.csv.gz");
    expect(
        gunzipSync(await readFile((await download.path())!)).toString(),
    ).toContain("1P/Halley");
    await page.locator("#small-bodies").uncheck();
    await expect(page.locator("#catalog-status")).toHaveText("点云已隐藏");
    await expect
        .poll(() => new URL(page.url()).searchParams.get("catalog"))
        .toBeNull();
    expect(errors).toEqual([]);
});

test("Mobile filters, satellite families and catalogs remain reachable without overflow", async ({
    page,
}) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?body=neptune&time=1788998400000");
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    await page.locator("#body-filter").selectOption("neptune");
    await expect(page.locator("[data-body]:visible")).toHaveCount(3);
    await page.locator("#family-view").click();
    await expect(page.locator("#view-title")).toHaveText("海王星与卫星系统");
    await page.screenshot({ path: "test-results/neptune-family-mobile.png" });
    await page.locator("#body-search").fill("Triton");
    await page.locator('[data-body="triton"]').click();
    await expect(page.locator("#body-name")).toHaveText("海卫一");
    await expect(page.locator("#parent-body")).toBeInViewport();
    await expect(page.locator("#play")).toBeInViewport();
    await page.locator("#catalog-shortcut").click();
    await expect(page.locator("#catalog-dialog")).toBeVisible();
    await page.locator("#catalog-category").selectOption("centaur_asteroid");
    await expect(page.locator("#catalog-summary")).toContainText(
        "1,021 条记录",
    );
    await expect(page.locator("#catalog-status")).toHaveText("点云已隐藏");
    await page.screenshot({ path: "test-results/catalog-mobile.png" });
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
    expect(
        await page
            .locator("#catalog-dialog")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.locator("#close-catalog").click();
    await page.locator("#parent-body").click();
    await expect(page.locator("#body-name")).toHaveText("海王星");
    expect(errors).toEqual([]);
});

test("All three added ring systems and sourced satellite facts render; Vesta model loads", async ({
    page,
}) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?body=uranus&time=1788998400000");
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    for (const id of ["uranus", "neptune", "jupiter"]) {
        await page.locator(`[data-body="${id}"]`).click();
        await renderedFrame(page);
        await expect(page.locator("#ring-source")).toContainText("NASA PDS");
        const visible = await page.locator("#viewport canvas").screenshot();
        await page.locator("#rings").uncheck();
        await renderedFrame(page);
        const hidden = await page.locator("#viewport canvas").screenshot();
        expect(visible.equals(hidden)).toBe(false);
        await page.locator("#rings").check();
        await renderedFrame(page);
        await page.screenshot({ path: `test-results/${id}-rings.png` });
    }
    await page.locator('[data-body="kerberos"]').click();
    await expect(page.locator("#body-radius")).toHaveText("6");
    await expect(page.locator("#body-mass")).toContainText("<");
    await expect(page.locator("#physical-source")).toContainText("上限");
    const model = page.waitForResponse(
        (response) =>
            response.url().endsWith("/models/vesta.glb") && response.ok(),
    );
    await page.locator('[data-body="vesta"]').click();
    await model;
    await renderedFrame(page);
    await page.screenshot({ path: "test-results/vesta-model.png" });
    expect(errors).toEqual([]);
});

test("Complete catalog search locates an unsampled asteroid and follows its orbit across time and reload", async ({
    page,
}) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?body=earth&time=1788998400000");
    await page.locator("#catalog-shortcut").click();
    await expect(page.locator("#catalog-index-info")).toContainText(
        "1,542,803",
    );
    await page.locator("#catalog-scope").selectOption("all");
    await page.locator("#catalog-search").fill("433");
    await expect(page.locator("#catalog-search-status")).toContainText(
        "匹配 1 个对象",
    );
    await expect(page.locator("#catalog-object")).toContainText("433 Eros");
    await page.locator("#catalog-focus").click();
    await expect(page.locator("#catalog-dialog")).toBeHidden();
    await expect(page.locator("#body-name")).toContainText("433 Eros");
    await expect(page.locator("#view-title")).toContainText("轨道跟随");
    const identity = new URL(page.url()).searchParams.get("object");
    expect(identity).toMatch(/^[a-f0-9]{24}$/);
    const distance = await page.locator("#distance-value").textContent();
    await page.locator("#next-day").click();
    await expect(page.locator("#distance-value")).not.toHaveText(distance!);
    await page.locator('[data-scale="physical"]').click();
    await page.reload();
    await expect(page.locator("#body-name")).toContainText("433 Eros");
    await expect(page.locator("#distance-value")).toContainText("AU");
    await renderedFrame(page);
    await page.screenshot({ path: "test-results/eros-follow.png" });
    await page.locator("#viewport canvas").focus();
    await page.keyboard.press("r");
    await expect(page.locator("#body-name")).toContainText("433 Eros");
    await page.locator("#overview").click();
    expect(new URL(page.url()).searchParams.get("object")).toBeNull();
    await page.locator('[data-body="moon"]').click();
    await expect(page.locator("#distance-title")).toHaveText("距地球");
    expect(errors).toEqual([]);
});

test("Right mouse drag pans without selecting a body, and reset recenters", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?body=earth&time=1788998400000");
    await expect(page.locator("#fps")).toHaveText(/\d+ FPS/);
    const label = page.locator(".body-label.earth");
    const before = (await label.boundingBox())!;
    await page.mouse.move(700, 410);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(810, 450, { steps: 12 });
    await page.mouse.up({ button: "right" });
    await expect
        .poll(async () => Math.abs((await label.boundingBox())!.x - before.x))
        .toBeGreaterThan(60);
    await expect(page.locator("#body-name")).toHaveText("地球");
    await page.locator("#viewport canvas").focus();
    await page.keyboard.press("r");
    await expect
        .poll(async () => Math.abs((await label.boundingBox())!.x - before.x))
        .toBeLessThan(6);
    await page.screenshot({ path: "test-results/pan-reset.png" });
});

test("Mobile full search follows a comet and unsupported records cannot be positioned", async ({
    page,
}) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?body=earth&time=1788998400000");
    await page.locator("#catalog-shortcut").click();
    await page.locator("#catalog-scope").selectOption("all");
    await page.locator("#catalog-search").fill("2002 PD153");
    await expect(page.locator("#catalog-object")).toContainText("2002 PD153");
    await expect(page.locator("#catalog-focus")).toBeDisabled();
    await expect(page.locator("#catalog-object-info")).toContainText("非椭圆");
    await page.locator("#catalog-search").fill("1P/Halley");
    await expect(page.locator("#catalog-object option")).toHaveCount(1);
    await expect(page.locator("#catalog-focus")).toBeEnabled();
    expect(
        await page
            .locator("#catalog-dialog")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.locator("#catalog-focus").click();
    await expect(page.locator("#body-name")).toHaveText("1P/Halley");
    await expect(page.locator("#play")).toBeInViewport();
    await page.locator("#speed").selectOption("86400");
    await page.locator("#play").click();
    await expect(page.locator("#date-input")).not.toHaveValue(
        "2026-09-10T00:00",
    );
    await page.locator("#play").click();
    await renderedFrame(page);
    await page.screenshot({ path: "test-results/halley-follow-mobile.png" });
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
    expect(errors).toEqual([]);
});

test("catalog icons use the same visual assets as model-backed bodies", async ({ page }) => {
    await page.goto("/?body=phobos");
    for (const id of ["phobos", "deimos", "eris", "haumea", "makemake", "vesta"]) {
        const style = await page.locator(`[data-body="${id}"] .planet-thumb`).getAttribute("style");
        expect(style, id).toContain(`thumbnails/${id}.png`);
    }
    for (const id of ["earth", "jupiter", "uranus", "moon"]) {
        const style = await page.locator(`[data-body="${id}"] .planet-thumb`).getAttribute("style");
        expect(style, id).toContain("textures/");
    }
});
