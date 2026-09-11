import test from "node:test";
import assert from "node:assert/strict";
import {
    DAY,
    parentOf,
    isSatellite,
    EXTENDED,
    extra,
    BODIES,
    BODY_IDS,
    PLANET_IDS,
    ORBIT_IDS,
    SATURN_RINGS,
    polarRatio,
    sunDistanceKm,
    MAX_TIME,
    MIN_TIME,
    RADII,
    clampTime,
    ephemeris,
    length,
    orbitSamples,
    parseUTC,
    phaseName,
    positions,
    radius,
    yearBounds,
} from "../src/model.ts";

test("Earth–Sun and Earth–Moon distances remain in physical ranges across the supported era", () => {
    for (const year of [1900, 1950, 2000, 2026, 2050, 2100]) {
        for (const month of [0, 3, 6, 9]) {
            const data = ephemeris(new Date(Date.UTC(year, month, 15)));
            assert.ok(data.earthSunKm > 146e6 && data.earthSunKm < 153e6);
            assert.ok(data.earthMoonKm > 350e3 && data.earthMoonKm < 410e3);
            assert.ok(data.phase >= 0 && data.phase < 360);
        }
    }
});
test("2024 April eclipse occurs near new moon; January is closer to the Sun than July", () => {
    const eclipse = ephemeris(new Date("2024-04-08T18:21:00Z"));
    assert.ok(Math.min(eclipse.phase, 360 - eclipse.phase) < 0.15);
    assert.equal(phaseName(eclipse.phase), "新月");
    assert.ok(
        ephemeris(new Date("2026-01-03T00:00:00Z")).earthSunKm <
            ephemeris(new Date("2026-07-04T00:00:00Z")).earthSunKm,
    );
});
test("Physical mode uses one scale for all ten bodies, including outer planets and the lunar offset", () => {
    const data = ephemeris(new Date("2026-09-10T12:00:00Z"));
    const p = positions(data, "physical");
    const kmPerUnit = RADII.earth / radius("earth", "physical");
    const moonDistance = Math.hypot(...p.moon.map((v, i) => v - p.earth[i]));
    assert.ok(Math.abs(length(p.earth) * kmPerUnit - data.earthSunKm) < 1e-6);
    assert.ok(Math.abs(moonDistance * kmPerUnit - data.earthMoonKm) < 1e-6);
    for (const id of BODY_IDS)
        assert.ok(
            Math.abs(radius(id, "physical") * kmPerUnit - RADII[id]) < 1e-6,
        );
    for (const id of PLANET_IDS)
        assert.ok(
            Math.abs(length(p[id]) * kmPerUnit - sunDistanceKm(data, id)) <
                1e-5,
        );
});

test("All eight planetary distances remain within their known orbital ranges across 1900–2100", () => {
    const ranges = {
        mercury: [0.3, 0.47],
        venus: [0.718, 0.73],
        earth: [0.98, 1.02],
        mars: [1.37, 1.68],
        jupiter: [4.94, 5.47],
        saturn: [8.98, 10.2],
        uranus: [18.2, 20.2],
        neptune: [29.6, 30.5],
    };
    for (const year of [1900, 1950, 2000, 2026, 2050, 2100]) {
        const data = ephemeris(new Date(Date.UTC(year, 5, 1)));
        const display = positions(data, "illustrated");
        for (const id of PLANET_IDS) {
            const au = length(data.heliocentric[id]);
            assert.ok(
                au > ranges[id][0] && au < ranges[id][1],
                `${id} ${year}: ${au} AU`,
            );
            for (let k = 0; k < 3; k++)
                assert.ok(
                    Math.abs(
                        display[id][k] / length(display[id]) -
                            data.heliocentric[id][k] / au,
                    ) < 1e-12,
                );
        }
    }
});

test("Every planetary orbit passes through its date's position in both scale modes, including time boundaries", () => {
    for (const time of [MIN_TIME, Date.UTC(2026, 8, 10), MAX_TIME]) {
        const date = new Date(time);
        const data = ephemeris(date);
        for (const mode of ["physical", "illustrated"] as const) {
            const p = positions(data, mode);
            for (const id of ORBIT_IDS) {
                const samples = orbitSamples(id, date, mode, 36);
                assert.equal(samples.length, 37);
                assert.ok(
                    samples.every((point) => point.every(Number.isFinite)),
                );
                const actual = isSatellite(id)
                    ? p[id].map((v, i) => v - p[parentOf(id)!][i])
                    : p[id];
                for (let k = 0; k < 3; k++)
                    assert.ok(
                        Math.abs(samples[18][k] - actual[k]) < 1e-8,
                        `${id} orbit/position mismatch`,
                    );
            }
        }
    }
});

test("Imported oblate dimensions and Saturn ring extents are physically plausible", () => {
    assert.equal(RADII.jupiter, 71492);
    assert.equal(RADII.saturn, 60268);
    assert.ok(polarRatio("jupiter") > 0.93 && polarRatio("jupiter") < 0.94);
    assert.ok(polarRatio("saturn") > 0.9 && polarRatio("saturn") < 0.91);
    assert.equal(SATURN_RINGS.innerKm, 74500);
    assert.equal(SATURN_RINGS.outerKm, 140445);
    assert.ok(SATURN_RINGS.innerKm > RADII.saturn);
});
test("Illustrated scale preserves sky direction but deliberately compresses distances", () => {
    const data = ephemeris(new Date("2026-09-10T12:00:00Z"));
    const p = positions(data, "illustrated");
    const a = positions(data, "physical");
    assert.ok(length(p.earth) < length(a.earth));
    for (let i = 0; i < 3; i++)
        assert.ok(
            Math.abs(
                p.earth[i] / length(p.earth) - a.earth[i] / length(a.earth),
            ) < 1e-12,
        );
    assert.ok(radius("sun", "illustrated") < radius("sun", "physical"));
});
test("UTC input rejects invalid dates and out-of-range years; leap-year scrubber is correct", () => {
    assert.equal(parseUTC("2024-02-29T12:00"), Date.UTC(2024, 1, 29, 12));
    for (const invalid of [
        "",
        "2023-02-29T12:00",
        "2101-01-01T00:00",
        "1899-12-31T23:59",
        "2024-13-01T00:00",
    ])
        assert.equal(parseUTC(invalid), null);
    assert.equal(parseUTC("1900-01-01T00:00"), MIN_TIME);
    assert.equal(parseUTC("2100-12-31T23:59"), MAX_TIME);
    const [start, end] = yearBounds(new Date("2024-06-01T00:00:00Z"));
    assert.equal(end - start + 1, 366 * DAY);
    assert.equal(clampTime(MAX_TIME + DAY), MAX_TIME);
    assert.equal(clampTime(MIN_TIME - DAY), MIN_TIME);
});
test("Orbit samples are finite, and lunar track is centered on Earth rather than the Sun", () => {
    for (const mode of ["physical", "illustrated"] as const) {
        const moon = orbitSamples(
            "moon",
            new Date("2026-09-10T00:00:00Z"),
            mode,
            36,
        );
        const earth = orbitSamples(
            "earth",
            new Date("2026-09-10T00:00:00Z"),
            mode,
            36,
        );
        assert.equal(moon.length, 37);
        for (const p of [...moon, ...earth])
            assert.ok(p.every(Number.isFinite));
        assert.ok(
            Math.max(...moon.map(length)) < Math.min(...earth.map(length)),
        );
    }
});
