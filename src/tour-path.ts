import { Vector3, CubicBezierCurve3 } from "three";
import { RotationAxis } from "astronomy-engine";
import {
    ASTRO_BODY,
    BODY_IDS,
    childrenOf,
    positions,
    radius,
    RADII,
    SATURN_RINGS,
    EXTRA_RINGS,
    eqjToScene,
    type BodyId,
    type Ephemeris,
} from "./model";

export interface TourStop {
    id: string;
    title: string;
    description: string;
    body?: BodyId;
    family?: boolean;
    region?: "belt" | "trojans" | "kuiper" | "system";
    catalog?: string;
    seconds: number;
}
export const TOUR_STOPS: TourStop[] = [
    {
        id: "sun",
        body: "sun",
        title: "从一颗恒星出发",
        description: "太阳的光，连接着这片辽阔的行星家园。",
        seconds: 20,
    },
    {
        id: "mercury",
        body: "mercury",
        title: "水星 · 靠近太阳的岩石世界",
        description: "密布的撞击坑，记录了漫长的太阳系历史。",
        seconds: 12,
    },
    {
        id: "venus",
        body: "venus",
        title: "金星 · 云层之下",
        description: "厚重的云层包裹着这颗炽热的邻星。",
        seconds: 12,
    },
    {
        id: "earth",
        body: "earth",
        family: true,
        title: "地球与月球",
        description: "回望熟悉的蓝色星球，也看看与它相伴的月球。",
        seconds: 18,
    },
    {
        id: "moon",
        body: "moon",
        title: "月球 · 寂静的近邻",
        description: "越过月海与明亮高地，从这里望向地球。",
        seconds: 12,
    },
    {
        id: "mars",
        body: "mars",
        family: true,
        title: "火星与两颗小卫星",
        description: "火卫一与火卫二，在红色行星身旁运行。",
        seconds: 16,
    },
    {
        id: "phobos",
        body: "phobos",
        title: "火卫一 · 不规则的小世界",
        description: "这颗形状不规则的卫星，每天绕火星运行数圈。",
        seconds: 12,
    },
    {
        id: "belt",
        region: "belt",
        catalog: "main_belt_asteroid",
        title: "穿行主小行星带",
        description: "点云来自完整目录的固定抽样，点的大小与亮度为示意。",
        seconds: 22,
    },
    {
        id: "ceres",
        body: "ceres",
        catalog: "main_belt_asteroid",
        title: "谷神星 · 小行星带中的矮行星",
        description: "这颗富含水的世界，是主带中最大的天体。",
        seconds: 12,
    },
    {
        id: "vesta",
        body: "vesta",
        catalog: "main_belt_asteroid",
        title: "灶神星 · 岩石与撞击的记忆",
        description: "跟随真实形状网格，观察这颗古老小行星的轮廓。",
        seconds: 12,
    },
    {
        id: "jupiter",
        body: "jupiter",
        family: true,
        title: "木星的微型行星系",
        description: "木卫一、木卫二、木卫三与木卫四，各自拥有独特的世界。",
        seconds: 18,
    },
    {
        id: "io",
        body: "io",
        title: "木卫一 · 火山世界",
        description: "木星强大的潮汐作用，为这个世界提供持续的内部热量。",
        seconds: 12,
    },
    {
        id: "europa",
        body: "europa",
        title: "木卫二 · 冰下的可能",
        description: "冰壳之下可能存在全球海洋；画面呈现的是它的表面影像。",
        seconds: 14,
    },
    {
        id: "ganymede",
        body: "ganymede",
        title: "木卫三 · 最大的卫星",
        description: "它的直径甚至超过水星。",
        seconds: 12,
    },
    {
        id: "callisto",
        body: "callisto",
        title: "木卫四 · 古老的撞击记录",
        description: "密布的环形山，让我们看见早期太阳系留下的痕迹。",
        seconds: 10,
    },
    {
        id: "trojans",
        region: "trojans",
        catalog: "jupiter_trojan_asteroid",
        title: "木星轨道上的同行者",
        description: "特洛伊小行星分布在木星轨道前后；画面为目录抽样。",
        seconds: 18,
    },
    {
        id: "saturn",
        body: "saturn",
        title: "土星 · 冰环的光影",
        description: "沿环面缓缓绕行，看细小颗粒共同构成的辽阔结构。",
        seconds: 20,
    },
    {
        id: "enceladus",
        body: "enceladus",
        title: "土卫二 · 冰封的海洋世界",
        description: "其南极喷流提示了地下海洋的存在；此处未模拟喷流。",
        seconds: 12,
    },
    {
        id: "titan",
        body: "titan",
        title: "土卫六 · 云雾中的世界",
        description: "这里显示卡西尼地表拼接图，帮助我们看穿浓厚大气。",
        seconds: 14,
    },
    {
        id: "iapetus",
        body: "iapetus",
        title: "土卫八 · 明暗之间",
        description: "两种截然不同的表面亮度，构成它独特的外貌。",
        seconds: 12,
    },
    {
        id: "uranus",
        body: "uranus",
        family: true,
        title: "天王星 · 侧身旋转的系统",
        description: "沿倾斜的赤道面观察暗环和主要卫星。缺测表面以纯色示意。",
        seconds: 18,
    },
    {
        id: "miranda",
        body: "miranda",
        title: "天卫五 · 尚待补齐的世界",
        description: "此处用参数椭球表示大小；尚未接入可靠的全球表面影像。",
        seconds: 10,
    },
    {
        id: "neptune",
        body: "neptune",
        family: true,
        title: "海王星与遥远的卫星",
        description: "越过稀薄的行星环，走近太阳系最外侧的大行星。",
        seconds: 18,
    },
    {
        id: "triton",
        body: "triton",
        title: "海卫一 · 逆行的伙伴",
        description: "这颗大型卫星沿逆行轨道运行，可能曾是被捕获的天体。",
        seconds: 14,
    },
    {
        id: "pluto",
        body: "pluto",
        family: true,
        title: "冥王星系统",
        description: "冥王星、冥卫一与四颗小卫星，在遥远外太阳系相伴。",
        seconds: 18,
    },
    {
        id: "charon",
        body: "charon",
        title: "冥卫一 · 大比例的伴侣",
        description: "它与冥王星共同绕着位于冥王星之外的质心运行。",
        seconds: 12,
    },
    {
        id: "kuiper",
        region: "kuiper",
        catalog: "transneptunian_object_asteroid",
        title: "海王星之外",
        description:
            "海王星外天体目录包含柯伊伯带及更遥远对象，这里只显示抽样。",
        seconds: 22,
    },
    {
        id: "haumea",
        body: "haumea",
        catalog: "transneptunian_object_asteroid",
        title: "妊神星 · 拉长的冰世界",
        description: "快速自转与细长外形引人注目，模型表面为艺术示意。",
        seconds: 12,
    },
    {
        id: "makemake",
        body: "makemake",
        catalog: "transneptunian_object_asteroid",
        title: "鸟神星 · 遥远的冰冷世界",
        description: "真实表面仍有许多未知；这里的模型采用艺术表示。",
        seconds: 12,
    },
    {
        id: "eris",
        body: "eris",
        title: "阋神星 · 更远的边界",
        description: "走近这颗遥远矮行星，表面细节为艺术示意。",
        seconds: 14,
    },
    {
        id: "sedna",
        body: "sedna",
        title: "塞德娜 · 漫长轨道的一瞬",
        description: "它的高偏心率轨道将它带往更遥远处；外观以纯色示意。",
        seconds: 14,
    },
    {
        id: "home",
        region: "system",
        title: "回望太阳系",
        description: "同一个模拟时刻，无数个世界。旅程会从太阳重新开始。",
        seconds: 26,
    },
];
export const TOUR_TRANSFER_SECONDS = 6;
export const TOUR_DURATION = TOUR_STOPS.reduce(
    (n, s) => n + s.seconds + TOUR_TRANSFER_SECONDS,
    0,
);
export const smooth = (t: number) => {
    t = Math.max(0, Math.min(1, t));
    return t * t * t * (t * (t * 6 - 15) + 10);
};
export interface TourFrame {
    camera: Vector3;
    target: Vector3;
}
export interface Obstacle {
    center: Vector3;
    radius: number;
}
interface Shot {
    stop: TourStop;
    center: Vector3;
    direction: Vector3;
    distance: number;
}
export interface TourPath {
    shots: Shot[];
    obstacles: Obstacle[];
    duration: number;
}

export function buildTourPath(
    data: Ephemeris,
    date: Date,
    aspect: number,
): TourPath {
    const points = positions(data, "illustrated");
    const obstacles = BODY_IDS.map((id) => ({
        center: new Vector3(...points[id]),
        radius: radius(id, "illustrated") * 1.25,
    }));
    const shots = TOUR_STOPS.map((stop) => {
        const center = new Vector3(
            ...(stop.body ? points[stop.body] : [0, 0, 0]),
        );
        let extent = stop.body ? radius(stop.body, "illustrated") : 1;
        let direction = center
            .clone()
            .negate()
            .normalize()
            .add(new Vector3(0.25, 0.35, 0.15))
            .normalize();
        if (stop.body === "sun") direction.set(0.5, 0.22, 1).normalize();
        if (stop.body) {
            const ring = EXTRA_RINGS[stop.body as keyof typeof EXTRA_RINGS];
            if (stop.body === "saturn")
                extent *= SATURN_RINGS.outerKm / RADII.saturn;
            else if (ring)
                extent *=
                    Math.max(...ring.bands.map((b) => b.outerKm)) /
                    RADII[stop.body];
            if (stop.body === "saturn" || ring) {
                const north = new Vector3(
                    ...eqjToScene(
                        RotationAxis(ASTRO_BODY[stop.body]!, date).north,
                    ),
                );
                if (north.dot(direction) < 0) north.negate();
                direction.addScaledVector(north, 0.8).normalize();
                obstacles.push({
                    center: center.clone(),
                    radius: extent * 1.06,
                });
            }
            if (stop.family) {
                extent = Math.max(
                    extent,
                    ...childrenOf(stop.body).map(
                        (id) =>
                            new Vector3(...points[id]).distanceTo(center) +
                            radius(id, "illustrated"),
                    ),
                );
                direction.add(new Vector3(0, 0.55, 0)).normalize();
            }
        } else if (stop.region === "belt") {
            center.copy(new Vector3(...points.ceres)).multiplyScalar(0.92);
            extent = 150;
            direction.set(0.4, 1, 0.8).normalize();
        } else if (stop.region === "trojans") {
            center.copy(new Vector3(...points.jupiter)).multiplyScalar(0.15);
            extent = new Vector3(...points.jupiter).length() * 0.7;
            direction.set(0.2, 1, 0.35).normalize();
        } else if (stop.region === "kuiper") {
            extent = new Vector3(...points.pluto).length() * 0.9;
            direction.set(0.15, 1, 0.35).normalize();
        } else {
            extent = Math.max(
                ...BODY_IDS.map((id) => new Vector3(...points[id]).length()),
            );
            direction.set(0.2, 1, 0.55).normalize();
        }
        const distance =
            extent *
            (stop.family || stop.region ? 3.8 : 4.4) *
            Math.max(1, 1 / Math.max(0.25, aspect));
        return { stop, center, direction, distance };
    });
    return { shots, obstacles, duration: TOUR_DURATION };
}

export function safeCamera(camera: Vector3, obstacles: Obstacle[]) {
    const result = camera.clone();
    for (let pass = 0; pass < 5; pass++)
        for (const obstacle of obstacles) {
            const delta = result.clone().sub(obstacle.center);
            if (delta.length() < obstacle.radius + 1) {
                if (delta.lengthSq() < 0.001) delta.set(0, 1, 0);
                result
                    .copy(obstacle.center)
                    .add(delta.setLength(obstacle.radius + 1));
            }
        }
    return result;
}
export function shotFrame(
    path: TourPath,
    index: number,
    progress: number,
): TourFrame {
    const shot = path.shots[index];
    const direction = shot.direction
        .clone()
        .applyAxisAngle(new Vector3(0, 1, 0), (smooth(progress) - 0.5) * 0.5);
    const camera = shot.center
        .clone()
        .addScaledVector(
            direction,
            shot.distance * (1.08 - 0.08 * Math.sin(Math.PI * progress)),
        );
    return {
        camera: safeCamera(camera, path.obstacles),
        target: shot.center.clone(),
    };
}
function segmentClear(a: Vector3, b: Vector3, obstacles: Obstacle[]) {
    const delta = b.clone().sub(a),
        length = delta.lengthSq();
    return obstacles.every((o) => {
        const t = length
            ? Math.max(
                  0,
                  Math.min(1, o.center.clone().sub(a).dot(delta) / length),
              )
            : 0;
        return (
            a.clone().addScaledVector(delta, t).distanceTo(o.center) > o.radius
        );
    });
}
export function transferCurve(
    start: Vector3,
    end: Vector3,
    obstacles: Obstacle[],
) {
    const span = start.distanceTo(end);
    if (span < 1e-6)
        return new CubicBezierCurve3(
            start.clone(),
            start.clone(),
            end.clone(),
            end.clone(),
        );
    const axis = end.clone().sub(start).normalize();
    const directions = [
        new Vector3(0, 1, 0),
        new Vector3(0, -1, 0),
        new Vector3(1, 0.4, 0).normalize(),
        new Vector3(-1, 0.4, 0).normalize(),
        new Vector3(0, 0.4, 1).normalize(),
        new Vector3(0, 0.4, -1).normalize(),
    ];
    for (const factor of [0.22, 0.65, 1.5, 4])
        for (const up of directions) {
            const lift = Math.max(1, span * factor);
            const curve = new CubicBezierCurve3(
                start.clone(),
                start
                    .clone()
                    .addScaledVector(axis, span * 0.12)
                    .addScaledVector(up, lift),
                end
                    .clone()
                    .addScaledVector(axis, -span * 0.12)
                    .addScaledVector(up, lift),
                end.clone(),
            );
            const points = curve.getPoints(180);
            if (
                points.every(
                    (p, i) => !i || segmentClear(points[i - 1], p, obstacles),
                )
            )
                return curve;
        }
    // Unusual date/geometry: retain a bounded path and project away from surfaces per frame.
    return new CubicBezierCurve3(
        start.clone(),
        start.clone().add(new Vector3(0, Math.max(span, 300), 0)),
        end.clone().add(new Vector3(0, Math.max(span, 300), 0)),
        end.clone(),
    );
}
