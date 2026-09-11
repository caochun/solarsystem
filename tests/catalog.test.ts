import test from "node:test";
import assert from "node:assert/strict";
import { createReadStream, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createHash } from "node:crypto";
import { keplerPosition } from "../src/kepler.ts";

const root = new URL("../public/", import.meta.url);
const summary = JSON.parse(readFileSync(new URL("catalogs/summary.json", root), "utf8"));

test("All sixteen complete catalog archives reproduce the downloaded original CSV hashes", async () => {
    assert.equal(summary.categories.length, 16);
    assert.equal(summary.categoriesMayOverlap, true);
    for (const category of summary.categories) {
        const hash = createHash("sha256");
        const stream = createReadStream(new URL(category.archive, root)).pipe(createGunzip());
        for await (const chunk of stream) hash.update(chunk);
        assert.equal(hash.digest("hex"), category.sha256, category.id);
    }
});

test("Preview counts match their files and all sampled orbits produce finite positions", () => {
    for (const category of summary.categories) {
        const rows = JSON.parse(readFileSync(new URL(category.sample, root), "utf8"));
        assert.equal(rows.length, category.displayed);
        assert.ok(rows.length <= category.total);
        assert.equal(new Set(rows.map((row: { name: string }) => row.name)).size, rows.length);
        for (const row of rows) {
            assert.ok(row.a > 0 && row.e >= 0 && row.e < 1 && row.period > 0);
            assert.ok(keplerPosition(row, Date.UTC(2026, 8, 10)).every(Number.isFinite));
        }
    }
});
