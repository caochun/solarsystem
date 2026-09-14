import {
    Body,
    Vector,
    GeoMoon,
    HelioVector,
    KM_PER_AU,
    MoonPhase,
    JupiterMoons,
    RotateVector,
    Rotation_EQJ_ECL,
} from "astronomy-engine";
import openSpace from "./openspace-data.json";
import extended from "./extended-data.json";
import supplemental from "./supplemental-data.json";
import lunarSurface from "./lunar-surface-data.json";
import { keplerPosition, type KeplerElements } from "./kepler";
import type { DataCompleteness } from "./catalog-types";

export const PLANET_IDS = [
    "mercury",
    "venus",
    "earth",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
] as const;
export type PlanetId = (typeof PLANET_IDS)[number];
export type BaseBodyId = "sun" | PlanetId | "moon";
export type ExtendedBodyId = keyof typeof extended.bodies;
export type BodyId = BaseBodyId | ExtendedBodyId;
export interface ExtendedBody {
    name: string;
    english: string;
    parent: string;
    category: string;
    radiiKm: number[];
    assetRadiiKm: number[] | null;
    orbit?: KeplerElements;
    orbitSource: string;
    texture: string | null;
    surface: string;
    model?: string;
    rotationDays?: number | null;
    radiusQuality?: string;
    stateKm?: number[];
}
/**
 * Local coverage level used by the explorer UI.  A model or texture makes an
 * object visually inspectable; an object with only orbital elements is shown
 * as a location point.  Objects without an orbit remain selectable as named
 * assets and are labelled accordingly.
 */
export function dataStatus(id: BodyId): DataCompleteness {
    const body = extra(id);
    if (!body) return "full-model";
    const hasVisual = Boolean(body.model || body.texture);
    if (hasVisual) return "full-model";
    if (body.orbit) return "orbit-point";
    return "name-only";
}
export const PHYSICAL = supplemental.physical;
export const EXTRA_RINGS = supplemental.rings;
export const EXTENDED = Object.fromEntries(
    Object.entries(extended.bodies).map(([id, body]) => {
        const physical = PHYSICAL[id as keyof typeof PHYSICAL];
        if (["nix", "hydra", "kerberos", "styx"].includes(id) && physical) {
            return [
                id,
                {
                    ...body,
                    radiiKm: Array(3).fill(physical.meanRadiusKm),
                    radiusQuality: "mean-estimate",
                    surface: `JPL 平均半径估计 ${physical.meanRadiusKm} ± ${physical.meanRadiusSigmaKm} km；使用等效球表示大小，未接入真实三轴形状与表面影像`,
                },
            ];
        }
        if (id === "vesta")
            return [
                id,
                {
                    ...body,
                    model: supplemental.vestaModel.path,
                    surface: supplemental.vestaModel.note,
                },
            ];
        return [id, body];
    }),
) as Record<ExtendedBodyId, ExtendedBody>;
export function physicalOf(id: BodyId) {
    return PHYSICAL[id as keyof typeof PHYSICAL];
}
export function extra(id: BodyId): ExtendedBody | undefined {
    return EXTENDED[id as ExtendedBodyId];
}
export function parentOf(id: BodyId): BodyId | null {
    return id === "sun"
        ? null
        : id === "moon"
          ? "earth"
          : ((extra(id)?.parent ?? "sun") as BodyId);
}
export function isSatellite(id: BodyId) {
    return id === "moon" || extra(id)?.category === "satellite";
}
export function childrenOf(id: BodyId) {
    return BODY_IDS.filter((body) => parentOf(body) === id);
}
export function textureOf(id: BodyId) {
    if (id === "moon") return lunarSurface.sceneColor.path.replace(/^textures\//, "");
    return extra(id) ? extra(id)!.texture : id === "sun" ? null : `${id}.jpg`;
}
/** Asset used by the compact catalogue icon. Model-only bodies use a small
 * rendered thumbnail generated from the same local GLB, while mapped bodies
 * reuse their actual albedo texture. */
export function thumbnailOf(id: BodyId) {
    const texture = textureOf(id);
    if (texture && (id === "moon" || extra(id)?.texture || !extra(id))) return texture;
    return extra(id)?.model ? `thumbnails/${id}.png` : null;
}
export function shapeRatios(id: BodyId): [number, number, number] {
    const axes = extra(id)?.radiiKm;
    return axes
        ? [1, axes[2] / axes[0], axes[1] / axes[0]]
        : [1, polarRatio(id), 1];
}
export const BODY_IDS: BodyId[] = [
    "sun",
    "mercury",
    "venus",
    "earth",
    "moon",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    ...(Object.keys(extended.bodies) as ExtendedBodyId[]),
];
export const ORBIT_IDS = BODY_IDS.filter(
    (id): id is Exclude<BodyId, "sun"> => id !== "sun",
);
export const ASTRO_BODY: Partial<Record<BodyId, Body>> = {
    sun: Body.Sun,
    mercury: Body.Mercury,
    venus: Body.Venus,
    earth: Body.Earth,
    moon: Body.Moon,
    mars: Body.Mars,
    jupiter: Body.Jupiter,
    saturn: Body.Saturn,
    uranus: Body.Uranus,
    neptune: Body.Neptune,
    pluto: Body.Pluto,
};
// Sidereal orbital periods in days; used only to choose the orbit sampling window.
export const PERIODS: Record<Exclude<BodyId, "sun">, number> = {
    mercury: 87.969,
    venus: 224.701,
    earth: 365.256,
    moon: 27.321661,
    mars: 686.98,
    jupiter: 4332.589,
    saturn: 10759.22,
    uranus: 30685.4,
    neptune: 60189,
    ...Object.fromEntries(
        Object.entries(EXTENDED).map(([id, body]) => [
            id,
            body.orbit?.period ?? 90560,
        ]),
    ),
} as Record<Exclude<BodyId, "sun">, number>;
export type ScaleMode = "illustrated" | "physical";
export type Vec3 = [number, number, number];
export const DAY = 86_400_000;
export const MIN_TIME = Date.UTC(1900, 0, 1);
export const MAX_TIME = Date.UTC(2100, 11, 31, 23, 59);
// The added planets use OpenSpace's equatorial and polar radii, converted to km.
export const RADII: Record<BodyId, number> = {
    sun: 695700,
    earth: 6371,
    moon: 1737.4,
    ...Object.fromEntries(
        Object.entries(EXTENDED).map(([id, body]) => [id, body.radiiKm[0]]),
    ),
    ...Object.fromEntries(
        Object.entries(openSpace.planets).map(([id, body]) => [
            id,
            body.radiiKm[0],
        ]),
    ),
} as Record<BodyId, number>;
export function polarRatio(id: BodyId): number {
    const body = openSpace.planets[id as keyof typeof openSpace.planets];
    return body ? body.radiiKm[2] / body.radiiKm[0] : 1;
}
export const SATURN_RINGS = openSpace.saturnRings;
export const DISPLAY_EARTH_RADIUS = 6;
const BASE_BODIES = {
    sun: {
        name: "太阳",
        english: "SUN",
        caption: "一切旅程的光源",
        kind: "G2V 型恒星",
        number: "01",
        color: "#f4bd74",
        description:
            "太阳系唯一的恒星。光与热从这里出发，约 8 分 20 秒后抵达地球。",
        radius: "695,700",
        mass: "1.989 × 10³⁰",
        rotation: "约 25 天 · 赤道",
        temperature: "5,772 K · 有效温度",
        fact: "太阳占据太阳系总质量的约 99.86%。它的引力把行星、彗星与小行星联系在一起。",
    },
    earth: {
        name: "地球",
        english: "EARTH",
        caption: "我们的蓝色星球",
        kind: "类地行星",
        number: "03",
        color: "#a8d7c5",
        description:
            "一颗被海洋与大气包裹的岩石行星。这里，是我们认识宇宙的起点。",
        radius: "6,371",
        mass: "5.972 × 10²⁴",
        rotation: "23 小时 56 分",
        temperature: "288 K · 平均表面",
        fact: "地轴约 23.4° 的倾斜带来四季。将时间向前推进，观察昼夜与公转如何共同发生。",
    },
    moon: {
        name: "月球",
        english: "MOON",
        caption: "熟悉而遥远的邻居",
        kind: "地球的天然卫星",
        number: "01",
        color: "#c5ccd5",
        description:
            "布满陨石坑的古老世界，始终将近乎同一面朝向地球，记录着太阳系的漫长历史。",
        radius: "1,737.4",
        mass: "7.342 × 10²²",
        rotation: "约 27.32 天",
        temperature: "约 100–400 K · 表面",
        fact: "月球的自转与公转周期近乎相同。月相的变化，来自太阳、地球与月球相对位置的改变。",
    },
    mercury: {
        name: "水星",
        english: "MERCURY",
        caption: "离太阳最近的岩石世界",
        kind: "类地行星",
        number: "01",
        color: "#b8ada0",
        description:
            "一个布满撞击坑的世界。稀薄的外逸层无法留住热量，昼夜温差十分悬殊。",
        radius: "2,439.7",
        mass: "3.301 × 10²³",
        rotation: "约 58.65 天",
        temperature: "约 100–700 K · 表面",
        fact: "水星每绕太阳公转两圈，自转三圈。它的一次太阳日约相当于 176 个地球日。",
    },
    venus: {
        name: "金星",
        english: "VENUS",
        caption: "浓云之下的炽热世界",
        kind: "类地行星",
        number: "02",
        color: "#e6c591",
        description:
            "与地球大小相近，却被浓厚的二氧化碳大气包裹。眼前所见是遮蔽地表的云层。",
        radius: "6,051.9",
        mass: "4.867 × 10²⁴",
        rotation: "约 243 天 · 逆行",
        temperature: "约 737 K · 表面",
        fact: "金星的自转比公转还慢。强烈的温室效应使它成为太阳系表面最热的行星。",
    },
    mars: {
        name: "火星",
        english: "MARS",
        caption: "红色星球的漫长往事",
        kind: "类地行星",
        number: "04",
        color: "#db9a77",
        description:
            "氧化铁为地表染上红色。火山、峡谷和干涸河道，留下了这个世界演变的线索。",
        radius: "3,396.19",
        mass: "6.417 × 10²³",
        rotation: "24 小时 37 分",
        temperature: "约 210 K · 平均表面",
        fact: "火星的一天与地球接近，但一年约有 687 个地球日。它也拥有因自转轴倾斜形成的四季。",
    },
    jupiter: {
        name: "木星",
        english: "JUPITER",
        caption: "云带与风暴的巨人",
        kind: "气态巨行星",
        number: "05",
        color: "#d8bca5",
        description:
            "太阳系最大的行星。明暗相间的云带环绕星球，巨大的风暴在大气中持续演变。",
        radius: "71,492",
        mass: "1.898 × 10²⁷",
        rotation: "约 9 小时 56 分",
        temperature: "约 165 K · 1 bar 大气层",
        fact: "木星快速的自转使赤道鼓起、两极变扁。大红斑是一场尺度超过地球直径的巨大风暴。",
    },
    saturn: {
        name: "土星",
        english: "SATURN",
        caption: "冰环环绕的世界",
        kind: "气态巨行星",
        number: "06",
        color: "#ddcfa4",
        description:
            "无数冰与岩石颗粒组成了宽阔而薄的环。旋转视角，观察环面倾角与其中的暗隙。",
        radius: "60,268",
        mass: "5.683 × 10²⁶",
        rotation: "约 10.7 小时",
        temperature: "约 134 K · 1 bar 大气层",
        fact: "土星环并非固体圆盘。各个颗粒沿自己的轨道运行，主要可见环的外缘距土星中心约 14 万千米。",
    },
    uranus: {
        name: "天王星",
        english: "URANUS",
        caption: "侧身旋转的冰巨星",
        kind: "冰巨行星",
        number: "07",
        color: "#a8d7db",
        description:
            "大气中的甲烷吸收红光，使这颗遥远的行星呈现淡青色。它几乎侧躺在公转轨道上。",
        radius: "25,559",
        mass: "8.681 × 10²⁵",
        rotation: "约 17.2 小时 · 逆行",
        temperature: "约 76 K · 1 bar 大气层",
        fact: "天王星的自转轴倾角约为 98°，一圈公转需要约 84 年，两极经历漫长的白昼与黑夜。",
    },
    neptune: {
        name: "海王星",
        english: "NEPTUNE",
        caption: "行星疆域的远方",
        kind: "冰巨行星",
        number: "08",
        color: "#91b5e8",
        description:
            "八大行星中距离太阳最远的一颗。微弱阳光照亮云层，大气中仍有强烈的风与风暴。",
        radius: "24,764",
        mass: "1.024 × 10²⁶",
        rotation: "约 16.1 小时",
        temperature: "约 72 K · 1 bar 大气层",
        fact: "海王星公转一周约需 165 年。本图沿用 OpenSpace 的蓝色纹理，其色彩不代表经过校准的肉眼所见。",
    },
} satisfies Record<BaseBodyId, Record<string, string>>;
const groupNames: Record<string, string> = {
    mars: "火星",
    jupiter: "木星",
    saturn: "土星",
    uranus: "天王星",
    neptune: "海王星",
    pluto: "冥王星",
    sun: "太阳",
};
const bodyFacts: Partial<Record<ExtendedBodyId, string>> = {
    io: "木卫一的潮汐加热驱动了频繁的火山活动。",
    europa: "木卫二的冰壳下可能存在全球海洋。",
    ganymede: "木卫三是太阳系最大的卫星，比水星还大。",
    callisto: "木卫四的撞击坑保留了漫长的地质历史。",
    titan: "土卫六拥有浓厚大气，地表存在液态甲烷和乙烷湖泊。",
    enceladus: "土卫二南极的喷流把冰粒与水蒸气送入太空。",
    triton: "海卫一沿逆行轨道绕海王星运行。",
    charon: "冥王星与冥卫一围绕位于冥王星之外的共同质心运行。",
    ceres: "谷神星是主小行星带中最大的天体，也是已确认的矮行星。",
    pluto: "新视野号在 2015 年飞掠冥王星，揭示了冰山与广阔的氮冰平原。",
    haumea: "妊神星快速旋转，呈明显的椭球形。",
    sedna: "塞德娜沿极为细长的轨道运行，一次公转需要约一万多年。",
};
export const BODIES: Record<BodyId, Record<string, string>> = {
    ...BASE_BODIES,
    ...Object.fromEntries(
        Object.entries(EXTENDED).map(([id, b]) => [
            id,
            {
                name: b.name,
                english: b.english,
                caption: `${b.name} · ${b.english}`,
                kind:
                    b.category === "satellite"
                        ? `${groupNames[b.parent]}的天然卫星`
                        : b.category === "dwarf"
                          ? "已确认矮行星"
                          : id === "vesta"
                            ? "主带小行星"
                            : "海王星外小天体",
                number: b.category === "satellite" ? "MOON" : "WORLD",
                color:
                    b.parent === "saturn"
                        ? "#d8cfba"
                        : b.category === "dwarf"
                          ? "#c9b2ce"
                          : "#b9c8ce",
                description:
                    bodyFacts[id as ExtendedBodyId] ??
                    (b.category === "satellite"
                        ? `环绕${groupNames[b.parent]}运行的世界。切换到卫星系统视图，可观察它与其他卫星的相对位置。`
                        : "太阳系中的小世界。它的轨道与形状为理解太阳系的形成提供线索。"),
                radius:
                    b.radiusQuality === "placeholder"
                        ? "未核定（定位球）"
                        : b.radiiKm[0].toLocaleString("zh-CN", {
                              maximumFractionDigits: 2,
                          }),
                mass: "未收录",
                rotation:
                    b.category === "satellite"
                        ? "朝向母星的姿态示意"
                        : b.rotationDays
                          ? `约 ${b.rotationDays.toFixed(3)} 天`
                          : "未收录",
                temperature: "未收录",
                fact: b.surface,
            },
        ]),
    ),
} as unknown as Record<BodyId, Record<string, string>>;
for (const [id, physical] of Object.entries(PHYSICAL)) {
    if (physical.massKg && BODIES[id as BodyId])
        BODIES[id as BodyId].mass =
            `${physical.massUpperLimit ? "< " : "≈ "}${physical.massKg.toExponential(3)}`;
}
export function sourceDescription(id: BodyId) {
    if (!extra(id)) return "Astronomy Engine 解析星历";
    if (extra(id)!.orbitSource.includes("JPL SBDB"))
        return `JPL SBDB 轨道 · 开普勒近似（历元 ${new Date(extra(id)!.orbit!.epoch).toISOString().slice(0, 10)}）`;
    if (id === "pluto" || extra(id)!.parent === "jupiter")
        return "解析星历 · OpenSpace 外观数据";
    return extra(id)!.orbitSource.includes("SPK")
        ? "SPICE 历元 → 开普勒近似（2026-09-10）"
        : "OpenSpace 开普勒轨道 · 历元外推";
}

// Fixed J2000 ecliptic frame, right-handed Y-up: (x, z, -y).
const toEcliptic = Rotation_EQJ_ECL();
export function eqjToScene(
    v: Pick<Parameters<typeof RotateVector>[1], "x" | "y" | "z" | "t">,
): Vec3 {
    const p = RotateVector(toEcliptic, new Vector(v.x, v.y, v.z, v.t));
    return [p.x, p.z, -p.y];
}
export function add(a: Vec3, b: Vec3): Vec3 {
    return a.map((v, i) => v + b[i]) as Vec3;
}
export function scale(a: Vec3, n: number): Vec3 {
    return a.map((v) => v * n) as Vec3;
}
export function length(a: Vec3): number {
    return Math.hypot(...a);
}
export function clampTime(time: number): number {
    return Math.min(MAX_TIME, Math.max(MIN_TIME, time));
}

export function relativeVector(id: BodyId, date: Date): Vec3 {
    if (id === "moon") return eqjToScene(GeoMoon(date));
    if (["io", "europa", "ganymede", "callisto"].includes(id))
        return eqjToScene(
            JupiterMoons(date)[id as "io" | "europa" | "ganymede" | "callisto"],
        );
    if (ASTRO_BODY[id]) return eqjToScene(HelioVector(ASTRO_BODY[id]!, date));
    const body = extra(id)!;
    const vector = keplerPosition(body.orbit!, date.getTime());
    if (body.parent === "pluto" && id !== "charon") {
        return add(
            vector,
            scale(
                keplerPosition(EXTENDED.charon.orbit!, date.getTime()),
                105.9 / 975.5,
            ),
        );
    }
    return vector;
}
export function ephemeris(date: Date) {
    const relative = {} as Record<BodyId, Vec3>;
    const heliocentric = {} as Record<BodyId, Vec3>;
    relative.sun = heliocentric.sun = [0, 0, 0];
    const jovian = JupiterMoons(date);
    for (const id of BODY_IDS) {
        if (id === "sun") continue;
        relative[id] =
            id in jovian
                ? eqjToScene(jovian[id as keyof typeof jovian])
                : relativeVector(id, date);
    }
    for (const id of BODY_IDS.filter((id) => parentOf(id) === "sun"))
        heliocentric[id] = relative[id];
    for (const id of BODY_IDS.filter(isSatellite))
        heliocentric[id] = add(heliocentric[parentOf(id)!], relative[id]);
    const earth = heliocentric.earth;
    const moonRelative = relative.moon;
    return {
        heliocentric,
        relative,
        earth,
        moonRelative,
        earthSunKm: length(earth) * KM_PER_AU,
        earthMoonKm: length(moonRelative) * KM_PER_AU,
        phase: MoonPhase(date),
    };
}
export type Ephemeris = ReturnType<typeof ephemeris>;
export function sunDistanceKm(data: Ephemeris, id: BodyId): number {
    return length(data.heliocentric[id]) * KM_PER_AU;
}
export function parentDistanceKm(data: Ephemeris, id: BodyId): number {
    return length(data.relative[id]) * KM_PER_AU;
}
export function solarPosition(vector: Vec3, mode: ScaleMode): Vec3 {
    const distance = length(vector);
    if (!distance) return [0, 0, 0];
    return scale(
        vector,
        mode === "physical"
            ? (KM_PER_AU / RADII.earth) * DISPLAY_EARTH_RADIUS
            : (330 * Math.pow(distance, 0.55)) / distance,
    );
}
export function localPosition(id: BodyId, vector: Vec3, mode: ScaleMode): Vec3 {
    if (!isSatellite(id)) return solarPosition(vector, mode);
    if (mode === "physical")
        return scale(vector, (KM_PER_AU / RADII.earth) * DISPLAY_EARTH_RADIUS);
    if (id === "moon") return scale(vector, 36 / (384400 / KM_PER_AU));
    const parent = parentOf(id)!;
    const distance = length(vector);
    const relativeRadii = (distance * KM_PER_AU) / RADII[parent];
    return scale(
        vector,
        (radius(parent, mode) * (1.4 + 0.8 * Math.sqrt(relativeRadii))) /
            distance,
    );
}
export function positions(
    data: Ephemeris,
    mode: ScaleMode,
): Record<BodyId, Vec3> {
    const result = { sun: [0, 0, 0] } as Record<BodyId, Vec3>;
    for (const id of BODY_IDS.filter((id) => parentOf(id) === "sun"))
        result[id] = solarPosition(data.relative[id], mode);
    for (const id of BODY_IDS.filter(isSatellite))
        result[id] = add(
            result[parentOf(id)!],
            localPosition(id, data.relative[id], mode),
        );
    return result;
}
export function radius(id: BodyId, mode: ScaleMode): number {
    const physical = (RADII[id] / RADII.earth) * DISPLAY_EARTH_RADIUS;
    if (mode === "physical") return physical;
    if (id === "sun") return 25;
    if (extra(id))
        return Math.max(
            isSatellite(id) ? 0.45 : 1,
            physical > 6 ? 6 * Math.pow(physical / 6, 0.55) : physical,
        );
    return physical > DISPLAY_EARTH_RADIUS
        ? DISPLAY_EARTH_RADIUS * Math.pow(physical / DISPLAY_EARTH_RADIUS, 0.55)
        : physical;
}
export function phaseName(angle: number): string {
    return [
        "新月",
        "娥眉月",
        "上弦月",
        "盈凸月",
        "满月",
        "亏凸月",
        "下弦月",
        "残月",
    ][Math.floor((angle + 22.5) / 45) % 8];
}
export function yearBounds(date: Date): [number, number] {
    return [
        Date.UTC(date.getUTCFullYear(), 0, 1),
        Math.min(MAX_TIME, Date.UTC(date.getUTCFullYear() + 1, 0, 1) - 1),
    ];
}
export function parseUTC(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const time = Date.parse(`${value}:00Z`);
    return Number.isFinite(time) &&
        time >= MIN_TIME &&
        time <= MAX_TIME &&
        new Date(time).toISOString().slice(0, 16) === value
        ? time
        : null;
}
export function orbitSamples(
    id: Exclude<BodyId, "sun">,
    date: Date,
    mode: ScaleMode,
    count = 180,
): Vec3[] {
    const period = PERIODS[id];
    return Array.from({ length: count + 1 }, (_, i) => {
        const t = new Date(date.getTime() + (i / count - 0.5) * period * DAY);
        return localPosition(id, relativeVector(id, t), mode);
    });
}
