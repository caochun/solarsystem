import {
    Body,
    Equator,
    Horizon,
    Illumination,
    Observer,
    type HorizontalCoordinates,
    SearchRiseSet,
} from "astronomy-engine";
import { ASTRO_BODY, type BodyId } from "./model";

export interface ObservatorySite {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    heightMeters: number;
}

export interface ObservationResult {
    site: ObservatorySite;
    target: BodyId;
    rightAscensionHours: number;
    declinationDeg: number;
    azimuthDeg: number;
    altitudeDeg: number;
    rangeKm: number;
    lightTimeSeconds: number;
    phaseAngleDeg: number | null;
    sunAltitudeDeg: number;
    aboveHorizon: boolean;
    astronomicalNight: boolean;
    observable: boolean;
    nextRiseTime: Date | null;
    nextSetTime: Date | null;
    maxAltitudeDeg: number;
    maxAltitudeTime: Date;
}

export const OBSERVATORY_SITES: ObservatorySite[] = [
    { id: "beijing", name: "北京", latitude: 39.9042, longitude: 116.4074, heightMeters: 43 },
    { id: "shanghai", name: "上海", latitude: 31.2304, longitude: 121.4737, heightMeters: 4 },
    { id: "mauna-kea", name: "莫纳克亚山", latitude: 19.8207, longitude: -155.4681, heightMeters: 4205 },
    { id: "custom", name: "自定义地点", latitude: 0, longitude: 0, heightMeters: 0 },
];

const bodyFor = (id: BodyId): Body | null => ASTRO_BODY[id] ?? null;

export function observe(
    target: BodyId,
    date: Date,
    site: ObservatorySite,
    refraction: "normal" | "jplhor" | "none" = "normal",
): ObservationResult | null {
    // A ground station cannot observe the Earth as an external target.
    if (target === "earth") return null;
    const body = bodyFor(target);
    if (!body) return null;
    const observer = new Observer(site.latitude, site.longitude, site.heightMeters);
    const equator = Equator(body, date, observer, true, true);
    const horizontal: HorizontalCoordinates = Horizon(
        date,
        observer,
        equator.ra,
        equator.dec,
        refraction,
    );
    const sun = Equator(Body.Sun, date, observer, true, true);
    const sunHorizontal = Horizon(date, observer, sun.ra, sun.dec, refraction);
    let rangeKm = equator.dist * 149597870.7;
    let phaseAngleDeg: number | null = null;
    const illumination = Illumination(body, date);
    rangeKm = illumination.geo_dist * 149597870.7;
    phaseAngleDeg = illumination.phase_angle;
    const aboveHorizon = horizontal.altitude > 0;
    const astronomicalNight = sunHorizontal.altitude < -18;
    const nextRise = SearchRiseSet(body, observer, +1, date, 2);
    const nextSet = SearchRiseSet(body, observer, -1, date, 2);
    let maxAltitudeDeg = -90;
    let maxAltitudeTime = date;
    for (let minutes = 0; minutes <= 24 * 60; minutes += 5) {
        const sampleDate = new Date(date.getTime() + minutes * 60_000);
        const sampleEquator = Equator(body, sampleDate, observer, true, true);
        const sampleHorizontal = Horizon(
            sampleDate,
            observer,
            sampleEquator.ra,
            sampleEquator.dec,
            refraction,
        );
        if (sampleHorizontal.altitude > maxAltitudeDeg) {
            maxAltitudeDeg = sampleHorizontal.altitude;
            maxAltitudeTime = sampleDate;
        }
    }
    return {
        site,
        target,
        rightAscensionHours: equator.ra,
        declinationDeg: equator.dec,
        azimuthDeg: horizontal.azimuth,
        altitudeDeg: horizontal.altitude,
        rangeKm,
        lightTimeSeconds: rangeKm / 299792.458,
        phaseAngleDeg,
        sunAltitudeDeg: sunHorizontal.altitude,
        aboveHorizon,
        astronomicalNight,
        observable: aboveHorizon && astronomicalNight,
        nextRiseTime: nextRise ? nextRise.date : null,
        nextSetTime: nextSet ? nextSet.date : null,
        maxAltitudeDeg,
        maxAltitudeTime,
    };
}

export function formatRightAscension(hours: number): string {
    const h = Math.floor(hours);
    const minutes = (hours - h) * 60;
    return `${String(h).padStart(2, "0")}h ${minutes.toFixed(1).padStart(4, "0")}m`;
}

export function formatDeclination(deg: number): string {
    const sign = deg < 0 ? "−" : "+";
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    return `${sign}${String(d).padStart(2, "0")}° ${(((abs - d) * 60).toFixed(1)).padStart(4, "0")}′`;
}
