import { test, expect } from "@playwright/test";

test("spacecraft photos keep their provenance and do not claim to be surface maps", async ({ page }) => {
    await page.goto("/?body=kerberos");
    await page.locator("#open-surface-reference").click();
    const dialog = page.locator("#surface-reference-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".reference-note")).toContainText("8 倍放大");
    await expect(dialog.locator(".reference-note")).toContainText("不随模拟时间变化");
    await expect(dialog.locator(".reference-credit")).toContainText("PIA20034");
    await expect.poll(() => dialog.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1320);
    await page.screenshot({ path: "test-results/surface-reference.png" });
    await dialog.getByRole("button", { name: "关闭参考图" }).click();
    await page.locator('[data-body="earth"]').click();
    await expect(page.locator("#open-surface-reference")).toBeHidden();
});

test("lunar observation loads LROC and LOLA and retains surface detail through optical cropping", async ({ page }) => {
    const errors: string[] = [], resources = new Set<string>();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type()==="error") errors.push(message.text()); });
    page.on("response", response => { if (response.ok()) resources.add(new URL(response.url()).pathname); });
    await page.goto(`/?body=moon&time=${Date.parse("2026-09-26T12:00:00Z")}`);
    await page.locator("#open-observatory").click();
    await page.locator("#observatory-site").selectOption("shanghai");
    for (const id of ["read-noise", "jitter", "scatter"])
        await page.locator(`#observatory-${id}`).fill("0");
    const capture = page.locator("#observatory-capture");
    const canvas = page.locator("#observatory-image");
    await capture.click();
    await expect(page.locator("#observatory-image-note")).toContainText("NASA LROC 8K / LOLA");
    for (const path of ["moon-lroc-8k.jpg", "moon-lola-normals.png", "moon-lola-normals-2k.png"])
        expect(resources.has(`/textures/${path}`), path).toBe(true);
    const statistics = () => canvas.evaluate((c: HTMLCanvasElement) => {
        const p=c.getContext("2d")!.getImageData(0,0,c.width,c.height).data;
        const brightness=(x:number,y:number)=>(p[(y*c.width+x)*4]+p[(y*c.width+x)*4+1]+p[(y*c.width+x)*4+2])/3;
        const center=[];
        for(let y=170;y<230;y++) for(let x=290;x<350;x++) center.push(brightness(x,y));
        const mean=center.reduce((a,b)=>a+b,0)/center.length;
        return {corner:brightness(0,0),mean,variance:center.reduce((a,b)=>a+(b-mean)**2,0)/center.length};
    });
    const full=await statistics();
    expect(full.mean).toBeGreaterThan(full.corner+15);
    expect(full.variance).toBeGreaterThan(10);
    await canvas.screenshot({ path: "test-results/moon-full.png" });
    for (const focal of ["100000", "10000000"]) {
        await page.locator("#observatory-focal-length").fill(focal);
        await page.locator("#observatory-focal-length").dispatchEvent("change");
        await capture.click();
        await expect(capture).toBeEnabled();
        const crop=await statistics();
        expect(crop.corner).toBeGreaterThan(full.corner+15);
        if (focal==="10000000") expect(crop.variance).toBeLessThan(full.variance/10);
        await canvas.screenshot({ path: `test-results/moon-focal-${focal}.png` });
    }
    expect(errors).toEqual([]);
});
