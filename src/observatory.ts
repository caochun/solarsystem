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
import starCatalog from "./stars.json";

export interface ObservatoryStar {
    id: string;
    azimuthDeg: number;
    altitudeDeg: number;
    magnitude: number;
    colorIndex: number | null;
}

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
    visualMagnitude: number;
    angularDiameterArcsec: number;
    sunSeparationDeg: number | null;
    moonSeparationDeg: number | null;
    airmass: number | null;
    quality: "good" | "limited" | "blocked";
    qualityNotes: string[];
}

export const OBSERVATORY_SITES: ObservatorySite[] = [
    { id: "beijing", name: "北京", latitude: 39.9042, longitude: 116.4074, heightMeters: 43 },
    { id: "shanghai", name: "上海", latitude: 31.2304, longitude: 121.4737, heightMeters: 4 },
    { id: "mauna-kea", name: "莫纳克亚山", latitude: 19.8207, longitude: -155.4681, heightMeters: 4205 },
    { id: "custom", name: "自定义地点", latitude: 0, longitude: 0, heightMeters: 0 },
];

const bodyFor = (id: BodyId): Body | null => ASTRO_BODY[id] ?? null;
const MEAN_RADIUS_KM: Partial<Record<BodyId, number>> = {
    sun: 696340,
    mercury: 2439.7,
    venus: 6051.8,
    moon: 1737.4,
    mars: 3389.5,
    jupiter: 69911,
    saturn: 58232,
    uranus: 25362,
    neptune: 24622,
    pluto: 1188.3,
};
const angularSeparationDeg = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) => {
    const ra1 = (a.ra * 15 * Math.PI) / 180;
    const ra2 = (b.ra * 15 * Math.PI) / 180;
    const dec1 = (a.dec * Math.PI) / 180;
    const dec2 = (b.dec * Math.PI) / 180;
    const cosine = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
    return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
};

export function starsForSky(date: Date, site: ObservatorySite): ObservatoryStar[] {
    const observer = new Observer(site.latitude, site.longitude, site.heightMeters);
    return starCatalog.stars.flatMap((star) => {
        const horizontal = Horizon(date, observer, star.ra, star.dec);
        return horizontal.altitude > -2
            ? [{
                  id: String(star.id),
                  azimuthDeg: horizontal.azimuth,
                  altitudeDeg: horizontal.altitude,
                  magnitude: star.mag,
                  colorIndex: star.ci,
              }]
            : [];
    });
}

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
    const moon = target === "moon" ? null : Equator(Body.Moon, date, observer, true, true);
    const sunSeparationDeg = target === "sun" ? null : angularSeparationDeg(equator, sun);
    const moonSeparationDeg = target === "moon" || !moon ? null : angularSeparationDeg(equator, moon);
    const radiusKm = MEAN_RADIUS_KM[target] ?? 1;
    const angularDiameterArcsec = (2 * Math.atan(radiusKm / rangeKm) * 206265);
    const airmass = horizontal.altitude > 0
        ? 1 / (Math.sin((horizontal.altitude * Math.PI) / 180) + 0.50572 * Math.pow(horizontal.altitude + 6.079, -1.6364))
        : null;
    const qualityNotes: string[] = [];
    if (!aboveHorizon) qualityNotes.push("目标低于地平线");
    if (target !== "sun" && sunHorizontal.altitude >= -18) qualityNotes.push("太阳高度不满足天文夜条件");
    if (aboveHorizon && horizontal.altitude < 15) qualityNotes.push("高度角低于 15°，大气扰动较大");
    if (sunSeparationDeg !== null && sunSeparationDeg < 30) qualityNotes.push("目标距离太阳小于 30°");
    if (moonSeparationDeg !== null && moonSeparationDeg < 10) qualityNotes.push("目标距离月球小于 10°");
    if (airmass !== null && airmass > 2) qualityNotes.push("空气质量路径较长");
    const quality = !aboveHorizon || (target !== "sun" && !astronomicalNight)
        ? "blocked"
        : qualityNotes.length > 0
          ? "limited"
          : "good";
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
        observable: aboveHorizon && (target === "sun" || astronomicalNight),
        nextRiseTime: nextRise ? nextRise.date : null,
        nextSetTime: nextSet ? nextSet.date : null,
        maxAltitudeDeg,
        maxAltitudeTime,
        visualMagnitude: illumination.mag,
        angularDiameterArcsec,
        sunSeparationDeg,
        moonSeparationDeg,
        airmass,
        quality,
        qualityNotes,
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
