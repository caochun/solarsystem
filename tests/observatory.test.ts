import test from "node:test";
import assert from "node:assert/strict";
import { OBSERVATORY_SITES, formatDeclination, formatRightAscension, observe, starsForSky } from "../src/observatory";

test("ground observatory computes topocentric coordinates for solar-system targets", () => {
    const result = observe("moon", new Date("2026-09-13T13:00:00Z"), OBSERVATORY_SITES[0]);
    assert.ok(result);
    assert.ok(result.azimuthDeg >= 0 && result.azimuthDeg < 360);
    assert.ok(result.altitudeDeg >= -90 && result.altitudeDeg <= 90);
    assert.ok(result.rangeKm > 300_000 && result.rangeKm < 450_000);
    assert.ok(Number.isFinite(result.lightTimeSeconds));
    assert.equal(typeof result.observable, "boolean");
});

test("observatory rejects geocentric Earth and formats sky coordinates", () => {
    assert.equal(observe("earth", new Date("2026-09-13T13:00:00Z"), OBSERVATORY_SITES[0]), null);
    assert.match(formatRightAscension(12.5), /12h/);
    assert.match(formatDeclination(-12.25), /−12°/);
});

test("local bright-star catalog projects finite stars above the horizon", () => {
    const stars = starsForSky(new Date("2026-09-18T12:00:00Z"), OBSERVATORY_SITES[0]);
    assert.ok(stars.length > 100);
    assert.ok(stars.every((star) => star.azimuthDeg >= 0 && star.azimuthDeg < 360));
    assert.ok(stars.every((star) => star.altitudeDeg > -2 && star.altitudeDeg <= 90));
});
