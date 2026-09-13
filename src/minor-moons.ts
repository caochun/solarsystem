import minorMoonData from "./minor-moons.json";
import { keplerPosition, type KeplerElements } from "./kepler";
import {
    BODIES,
    RADII,
    radius,
    solarPosition,
    type BodyId,
    type Ephemeris,
    type ScaleMode,
} from "./model";
import type { CatalogObject } from "./catalog-types";
import supplemental from "./supplemental-data.json";

type PhysicalData = (typeof supplemental.physical)[keyof typeof supplemental.physical];

export interface MinorMoon extends CatalogObject {
    kind: "minor-moon";
    parentBody: Extract<BodyId, "jupiter" | "saturn" | "uranus" | "neptune">;
    english: string;
    sourceUrl: string;
    sourceEpoch: string;
    orbit: KeplerElements;
    dataStatus: "orbit-point";
    physical?: PhysicalData;
    /** Optional local SPICE position samples, ordered by UTC milliseconds. */
    spiceSamples?: SpiceSample[];
}
export type OrbitAccuracy = "near-epoch" | "extended" | "far";
export type SpiceSample = [time: number, x: number, y: number, z: number];
export type OrbitTarget = CatalogObject | MinorMoon;
export const MINOR_MOONS: MinorMoon[] = minorMoonData.bodies.map((body) => ({
    id: body.id,
    name: body.name,
    english: body.english,
    orbit: body.orbit,
    sourceCategory: "minor-moon",
    categories: ["minor", "satellite", body.parent],
    kind: "minor-moon",
    parentBody: body.parent as MinorMoon["parentBody"],
    sourceUrl: body.source,
    sourceEpoch: body.sourceEpoch ?? minorMoonData.epoch,
    dataStatus: "orbit-point",
    physical: supplemental.physical[body.id as keyof typeof supplemental.physical],
}));
export const MINOR_MOON_BY_ID = new Map(
    MINOR_MOONS.map((moon) => [moon.id, moon]),
);
export const isMinorMoon = (
    target: OrbitTarget | null | undefined,
): target is MinorMoon =>
    Boolean(target && "kind" in target && target.kind === "minor-moon");

/** Classify the distance from the SPICE state epoch used by the local model. */
export function orbitAccuracy(target: OrbitTarget, time: number): OrbitAccuracy {
    const days = Math.abs(time - target.orbit!.epoch) / 86_400_000;
    if (days <= 90) return "near-epoch";
    if (days <= 730) return "extended";
    return "far";
}

/** Interpolate local SPICE samples and fall back to the osculating ellipse. */
export function relativePosition(target: OrbitTarget, time: number): [number, number, number] {
    if (!isMinorMoon(target) || !target.spiceSamples || target.spiceSamples.length < 2)
        return keplerPosition(target.orbit!, time);
    const samples = target.spiceSamples;
    if (time < samples[0][0] || time > samples[samples.length - 1][0])
        return keplerPosition(target.orbit!, time);
    const hi = samples.findIndex((sample) => sample[0] >= time);
    if (hi <= 0) return samples[0].slice(1) as [number, number, number];
    const lo = hi - 1;
    const a = samples[lo], b = samples[hi];
    const fraction = (time - a[0]) / Math.max(b[0] - a[0], 1);
    return [a[1] + (b[1] - a[1]) * fraction, a[2] + (b[2] - a[2]) * fraction, a[3] + (b[3] - a[3]) * fraction];
}

export function targetOffset(
    target: OrbitTarget,
    relativeAU: [number, number, number],
    mode: ScaleMode,
): [number, number, number] {
    if (!isMinorMoon(target)) return solarPosition(relativeAU, mode);
    const parentRadius = radius(target.parentBody, mode);
    const distanceKm = Math.max(Math.hypot(...relativeAU) * 149597870.7, 1);
    const factor =
        mode === "physical"
            ? radius("earth", "physical") / RADII.earth
            : (parentRadius *
                  (1.4 +
                      0.8 *
                          Math.sqrt(
                              Math.max(
                                  0.001,
                                  distanceKm / RADII[target.parentBody],
                              ),
                          ))) /
              distanceKm;
    return [
        relativeAU[0] * 149597870.7 * factor,
        relativeAU[1] * 149597870.7 * factor,
        relativeAU[2] * 149597870.7 * factor,
    ];
}

export function targetPosition(
    target: OrbitTarget,
    data: Ephemeris,
    time: number,
    mode: ScaleMode,
): [number, number, number] {
    const relative = relativePosition(target, time);
    if (!isMinorMoon(target)) return solarPosition(relative, mode);
    const parent = data.heliocentric[target.parentBody];
    const parentScene = solarPosition(parent, mode);
    const offset = targetOffset(target, relative, mode);
    return [
        parentScene[0] + offset[0],
        parentScene[1] + offset[1],
        parentScene[2] + offset[2],
    ];
}

export function targetOrbitPoints(
    target: OrbitTarget,
    mode: ScaleMode,
): [number, number, number][] {
    const points = Array.from({ length: 180 }, (_, i) => {
        const M = (i / 180) * Math.PI * 2;
        const orbit = { ...target.orbit!, m: (M * 180) / Math.PI };
        return targetOffset(
            target,
            keplerPosition(orbit, target.orbit!.epoch),
            mode,
        );
    });
    return points;
}
