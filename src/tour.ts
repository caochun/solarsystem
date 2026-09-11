import { Vector3, type CubicBezierCurve3 } from "three";
import type { SolarScene } from "./scene";
import type { KeplerElements } from "./kepler";
import {
    TOUR_STOPS,
    TOUR_TRANSFER_SECONDS,
    buildTourPath,
    shotFrame,
    transferCurve,
    safeCamera,
    smooth,
    type TourFrame,
    type TourPath,
} from "./tour-path";

export class SolarTour {
    active = false;
    private paused = false;
    private elapsed = 0;
    private path: TourPath | null = null;
    private curves: CubicBezierCurve3[] = [];
    private starts: number[] = [];
    private restoreScene: (() => void) | null = null;
    private restorePlayback: (() => void) | null = null;
    private focused: HTMLElement | null = null;
    private hiddenElements: Array<{ element: HTMLElement; inert: boolean }> =
        [];
    private abort: AbortController | null = null;
    private clouds = new Map<string, KeplerElements[]>();
    private failedClouds = new Set<string>();
    private currentCloud: string | undefined;
    private currentStop = -1;
    private hudUntil = 0;
    private notes = false;
    private ownedFullscreen = false;
    private entryGeneration = 0;
    private rejoin: {
        curve: CubicBezierCurve3;
        target: Vector3;
        end: TourFrame;
        time: number;
        duration: number;
    } | null = null;
    private resizePending = false;
    private root: HTMLElement;
    private hud: HTMLElement;
    private caption: HTMLElement;
    private lastHudUpdate = 0;
    private destroyed = false;

    constructor(
        private scene: SolarScene,
        private suspendPlayback: () => () => void,
    ) {
        this.root = document.createElement("section");
        this.root.id = "solar-tour";
        this.root.hidden = true;
        this.root.setAttribute("aria-label", "太阳系沉浸漫游");
        this.root.innerHTML = `<div id="tour-caption" hidden><span id="tour-chapter"></span><h2 id="tour-title"></h2><p id="tour-description"></p><p class="tour-note">当前日期的空间导览 · 大小与距离经过压缩</p></div>
          <div id="tour-hud"><div class="tour-heading"><span>太阳系漫游</span><span id="tour-progress"></span></div>
          <p id="tour-status" role="status"></p><div class="tour-controls">
          <button id="tour-previous" aria-label="上一站">←</button><button id="tour-pause" aria-label="暂停漫游">暂停</button><button id="tour-next" aria-label="下一站">→</button>
          <button id="tour-notes" aria-pressed="false">讲解 · N</button><label>速度<select id="tour-speed" aria-label="漫游速度"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
          <label class="tour-loop"><input id="tour-loop" type="checkbox" checked/>循环</label><button id="tour-exit">退出 · Esc</button></div>
          <p class="tour-keys">空格暂停 / 继续 · ← → 切换站点 · N 讲解 · F / Esc 退出<br/>暂停后可拖动旋转、右键平移、滚轮缩放；移动鼠标或轻触可唤出控制</p></div>`;
        document.body.append(this.root);
        this.hud = this.q("tour-hud");
        this.caption = this.q("tour-caption");
        this.q("tour-pause").onclick = () => this.togglePause();
        this.q("tour-exit").onclick = () => this.stop();
        this.q("tour-next").onclick = () => this.skip(1);
        this.q("tour-previous").onclick = () => this.skip(-1);
        this.q("tour-notes").onclick = () => this.toggleNotes();
        document.addEventListener("keydown", this.keydown, true);
        document.addEventListener("pointermove", this.wake);
        document.addEventListener("pointerdown", this.wake);
        document.addEventListener("fullscreenchange", this.fullscreenChanged);
        document.addEventListener("visibilitychange", this.visibilityChanged);
        window.addEventListener("resize", this.resized);
        scene.renderer.domElement.addEventListener(
            "webglcontextlost",
            this.contextLost,
        );
    }
    private q<T extends HTMLElement = HTMLElement>(id: string) {
        return this.root.querySelector<T>(`#${id}`)!;
    }
    private editable(target: EventTarget | null) {
        return (
            target instanceof HTMLInputElement ||
            target instanceof HTMLSelectElement ||
            target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement && target.isContentEditable)
        );
    }
    private keydown = (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        if (!this.active) {
            if (
                key !== "f" ||
                event.repeat ||
                this.editable(event.target) ||
                document.querySelector("dialog[open]")
            )
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            void this.start();
            return;
        }
        if (key === "escape" || key === "f") {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) this.stop();
            return;
        }
        if (key === "tab") {
            this.reveal();
            return;
        }
        if (this.editable(event.target)) return;
        if ([" ", "arrowright", "arrowleft", "n", "r"].includes(key)) {
            // Buttons keep their native Space activation; the page's simulation hotkeys remain suspended.
            event.stopImmediatePropagation();
            if (key === " " && event.target instanceof HTMLButtonElement)
                return;
            event.preventDefault();
            if (event.repeat) return;
            if (key === " ") this.togglePause();
            if (key === "arrowright") this.skip(1);
            if (key === "arrowleft") this.skip(-1);
            if (key === "n") this.toggleNotes();
            if (key === "r") this.rejoinRoute();
        } else if (/^[0-9]$/.test(key)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    async start() {
        if (
            this.active ||
            this.destroyed ||
            document.querySelector("dialog[open]")
        )
            return;
        this.active = true;
        this.paused = false;
        this.elapsed = 0;
        this.currentStop = -1;
        this.currentCloud = undefined;
        this.clouds.clear();
        this.failedClouds.clear();
        this.notes = false;
        this.ownedFullscreen = false;
        this.resizePending = false;
        this.rejoin = null;
        const generation = ++this.entryGeneration;
        this.focused = document.activeElement as HTMLElement;
        // Request synchronously in the actual F/click gesture. Unsupported browsers still get the immersive layout.
        const requestedFullscreen = !document.fullscreenElement;
        let fullscreen: Promise<void> | undefined;
        try {
            if (requestedFullscreen)
                fullscreen = document.documentElement.requestFullscreen?.();
        } catch {
            fullscreen = Promise.reject(new Error("Fullscreen unavailable"));
        }
        // Attach a handler now; preparation below remains synchronous within this gesture.
        const fullscreenResult = fullscreen?.then(
            () => true,
            () => false,
        );
        this.restorePlayback = this.suspendPlayback();
        document.body.classList.add("tour-active");
        this.root.hidden = false;
        this.caption.hidden = true;
        this.q("tour-notes").setAttribute("aria-pressed", "false");
        this.hiddenElements = Array.from(
            document.querySelectorAll<HTMLElement>(
                "#app > header,#app > footer,main > :not(#viewport),#toast",
            ),
        ).map((element) => ({ element, inert: element.inert }));
        for (const { element } of this.hiddenElements) element.inert = true;
        const saved = this.scene.beginTour();
        this.restoreScene = saved.restore;
        this.path = buildTourPath(
            saved.data,
            saved.date,
            this.scene.camera.aspect,
        );
        this.root.dataset.aspectFactor = String(
            Math.max(1, 1 / Math.max(0.25, this.scene.camera.aspect)),
        );
        this.starts = [];
        let start = 0;
        for (const stop of TOUR_STOPS) {
            this.starts.push(start);
            start += stop.seconds + TOUR_TRANSFER_SECONDS;
        }
        this.buildCurves();
        this.scene.renderer.domElement.focus({ preventScroll: true });
        this.scene.setTourFrame(...this.frameArgs(this.routeFrame()));
        this.q("tour-status").textContent =
            "旅程从太阳开始，约 11 分钟后返回。控制面板会自动收起。";
        this.reveal(6500);
        this.updateStop(0);
        this.syncHud();
        this.abort = new AbortController();
        for (const category of new Set(
            TOUR_STOPS.map((s) => s.catalog).filter((s): s is string =>
                Boolean(s),
            ),
        )) {
            void fetch(`${import.meta.env.BASE_URL}catalogs/${category}.json`, {
                signal: this.abort.signal,
            })
                .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                })
                .then((rows: KeplerElements[]) => {
                    if (!this.active || this.entryGeneration !== generation)
                        return;
                    this.clouds.set(category, rows);
                    if (this.currentCloud === category)
                        this.scene.setTourCloud(rows);
                })
                .catch((error) => {
                    if (
                        error.name === "AbortError" ||
                        !this.active ||
                        this.entryGeneration !== generation
                    )
                        return;
                    this.failedClouds.add(category);
                    if (this.currentCloud === category) this.setCloud(category);
                });
        }
        try {
            const allowed = fullscreenResult ? await fullscreenResult : false;
            if (!this.active || generation !== this.entryGeneration) {
                if (
                    !this.active &&
                    requestedFullscreen &&
                    document.fullscreenElement === document.documentElement
                )
                    void document.exitFullscreen().catch(() => {});
                return;
            }
            this.ownedFullscreen = Boolean(
                requestedFullscreen &&
                allowed &&
                document.fullscreenElement === document.documentElement,
            );
            if (!document.fullscreenElement)
                this.q("tour-status").textContent =
                    "当前浏览器未启用系统全屏，已进入沉浸布局；F / Esc 可退出。";
            this.resizePending = true;
        } catch {
            if (this.active && generation === this.entryGeneration) {
                this.q("tour-status").textContent =
                    "浏览器未允许全屏，已进入沉浸布局；F / Esc 可退出。";
                this.reveal(6500);
            }
        }
    }
    private buildCurves() {
        const path = this.path!;
        this.curves = TOUR_STOPS.map((_, i) =>
            transferCurve(
                shotFrame(path, i, 1).camera,
                shotFrame(path, (i + 1) % TOUR_STOPS.length, 0).camera,
                path.obstacles,
            ),
        );
    }
    private frameArgs(frame: TourFrame): [Vector3, Vector3] {
        return [frame.camera, frame.target];
    }
    private phase() {
        let index = this.starts.length - 1;
        while (index > 0 && this.elapsed < this.starts[index]) index--;
        return { index, local: this.elapsed - this.starts[index] };
    }
    private routeFrame(): TourFrame {
        const { index, local } = this.phase(),
            stop = TOUR_STOPS[index],
            path = this.path!;
        if (local <= stop.seconds)
            return shotFrame(path, index, local / stop.seconds);
        const next = (index + 1) % TOUR_STOPS.length,
            t = smooth((local - stop.seconds) / TOUR_TRANSFER_SECONDS);
        return {
            camera: safeCamera(this.curves[index].getPoint(t), path.obstacles),
            target: shotFrame(path, index, 1).target.lerp(
                shotFrame(path, next, 0).target,
                t,
            ),
        };
    }
    private setCloud(category: string | undefined) {
        this.currentCloud = category;
        this.scene.setTourCloud(
            category ? (this.clouds.get(category) ?? []) : [],
        );
        if (category && this.failedClouds.has(category)) {
            this.q("tour-status").textContent =
                "这一站的目录点云未能加载，继续展示已有天体。退出后可重试。";
            this.reveal(5000);
        }
    }
    private updateStop(index: number) {
        if (this.currentStop === index) return;
        this.currentStop = index;
        const stop = TOUR_STOPS[index];
        this.root.dataset.stop = stop.id;
        this.q("tour-chapter").textContent =
            `${String(index + 1).padStart(2, "0")} / ${TOUR_STOPS.length}`;
        this.q("tour-title").textContent = stop.title;
        this.q("tour-description").textContent = stop.description;
        this.setCloud(stop.catalog);
        if (stop.body) this.scene.prepareTourBody(stop.body, stop.family);
        const next = TOUR_STOPS[(index + 1) % TOUR_STOPS.length];
        if (next.body) this.scene.prepareTourBody(next.body, next.family);
    }
    update(dt: number) {
        if (!this.active || !this.path) return;
        if (this.resizePending) {
            this.resizePending = false;
            const size = this.scene.renderer.domElement.getBoundingClientRect();
            const first = this.path;
            // Preserve the same world positions, but fit the changed aspect ratio.
            const factor = Math.max(
                1,
                1 / Math.max(0.25, size.width / Math.max(1, size.height)),
            );
            const oldFactor = Number(this.root.dataset.aspectFactor || factor);
            for (const shot of first.shots) shot.distance *= factor / oldFactor;
            this.root.dataset.aspectFactor = String(factor);
            this.buildCurves();
            if (!this.paused) this.rejoinRoute(1.5);
        }
        if (this.rejoin && !this.paused) {
            this.rejoin.time += dt;
            const t = smooth(this.rejoin.time / this.rejoin.duration);
            this.scene.setTourFrame(
                safeCamera(this.rejoin.curve.getPoint(t), this.path.obstacles),
                this.rejoin.target.clone().lerp(this.rejoin.end.target, t),
            );
            if (t >= 1) this.rejoin = null;
        } else if (!this.paused) {
            const speed = Number(this.q<HTMLSelectElement>("tour-speed").value);
            this.elapsed += dt * speed;
            if (this.elapsed >= this.path.duration) {
                if (!this.q<HTMLInputElement>("tour-loop").checked) {
                    this.stop();
                    return;
                }
                this.elapsed %= this.path.duration;
            }
            const phase = this.phase();
            this.updateStop(phase.index);
            if (phase.local > TOUR_STOPS[phase.index].seconds) {
                const next = TOUR_STOPS[(phase.index + 1) % TOUR_STOPS.length];
                if (
                    next.catalog !== this.currentCloud &&
                    phase.local - TOUR_STOPS[phase.index].seconds >
                        TOUR_TRANSFER_SECONDS * 0.5
                )
                    this.setCloud(next.catalog);
            }
            this.scene.setTourFrame(...this.frameArgs(this.routeFrame()));
        }
        this.root.dataset.state = this.paused ? "paused" : "playing";
        if (performance.now() - this.lastHudUpdate > 200) {
            this.syncHud();
            this.lastHudUpdate = performance.now();
        }
        const visible =
            performance.now() < this.hudUntil ||
            this.hud.contains(document.activeElement);
        this.hud.classList.toggle("is-hidden", !visible);
        this.hud.inert = !visible;
        document.body.classList.toggle("tour-idle", !visible && !this.paused);
    }
    private syncHud() {
        const format = (n: number) =>
            `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
        this.q("tour-progress").textContent =
            `${format(this.elapsed)} / ${format(this.path?.duration ?? 0)} · ${this.currentStop + 1}/${TOUR_STOPS.length}`;
        this.q("tour-pause").textContent = this.paused ? "继续" : "暂停";
        this.q("tour-pause").setAttribute(
            "aria-label",
            this.paused ? "继续漫游" : "暂停漫游",
        );
    }
    private rejoinRoute(duration = 2.5) {
        if (!this.path) return;
        const end = this.routeFrame();
        if (
            this.scene.camera.position.distanceTo(end.camera) < 1e-6 &&
            this.scene.controls.target.distanceTo(end.target) < 1e-6
        ) {
            this.rejoin = null;
            return;
        }
        this.rejoin = {
            curve: transferCurve(
                this.scene.camera.position,
                end.camera,
                this.path.obstacles,
            ),
            target: this.scene.controls.target.clone(),
            end,
            time: 0,
            duration,
        };
    }
    togglePause() {
        if (!this.active) return;
        this.paused = !this.paused;
        this.scene.setTourPaused(this.paused);
        if (!this.paused) this.rejoinRoute();
        this.q("tour-status").textContent = this.paused
            ? "已暂停。现在可以用鼠标旋转、平移和缩放；空格继续。"
            : "继续旅程。";
        this.reveal();
        this.syncHud();
    }
    private skip(direction: number) {
        if (!this.active) return;
        const index =
            (this.currentStop + direction + TOUR_STOPS.length) %
            TOUR_STOPS.length;
        this.elapsed = this.starts[index];
        this.updateStop(index);
        this.paused = false;
        this.scene.setTourPaused(false);
        this.rejoinRoute(4);
        this.q("tour-status").textContent = `前往：${TOUR_STOPS[index].title}`;
        this.reveal();
        this.syncHud();
    }
    private toggleNotes() {
        this.notes = !this.notes;
        this.caption.hidden = !this.notes;
        this.q("tour-notes").setAttribute("aria-pressed", String(this.notes));
        this.reveal();
    }
    private reveal(duration = 3500) {
        this.hudUntil = performance.now() + duration;
        this.hud.classList.remove("is-hidden");
        this.hud.inert = false;
        document.body.classList.remove("tour-idle");
    }
    private wake = () => {
        if (this.active) this.reveal();
    };
    private resized = () => {
        if (this.active) this.resizePending = true;
    };
    private contextLost = () => {
        if (this.active) this.stop();
    };
    private visibilityChanged = () => {
        if (this.active && document.hidden && !this.paused) this.togglePause();
    };
    private fullscreenChanged = () => {
        if (this.active && this.ownedFullscreen && !document.fullscreenElement)
            this.stop(false);
    };
    stop(exitFullscreen = true) {
        if (!this.active) return;
        this.active = false;
        this.entryGeneration++;
        this.abort?.abort();
        this.abort = null;
        this.rejoin = null;
        this.path = null;
        document.body.classList.remove("tour-active", "tour-idle");
        this.root.hidden = true;
        delete this.root.dataset.aspectFactor;
        for (const { element, inert } of this.hiddenElements)
            element.inert = inert;
        this.hiddenElements = [];
        this.restoreScene?.();
        this.restoreScene = null;
        this.restorePlayback?.();
        this.restorePlayback = null;
        this.focused?.focus({ preventScroll: true });
        if (
            exitFullscreen &&
            this.ownedFullscreen &&
            document.fullscreenElement
        )
            void document.exitFullscreen().catch(() => {});
        this.ownedFullscreen = false;
    }
    dispose() {
        this.stop();
        this.destroyed = true;
        document.removeEventListener("keydown", this.keydown, true);
        document.removeEventListener("pointermove", this.wake);
        document.removeEventListener("pointerdown", this.wake);
        document.removeEventListener(
            "fullscreenchange",
            this.fullscreenChanged,
        );
        document.removeEventListener(
            "visibilitychange",
            this.visibilityChanged,
        );
        window.removeEventListener("resize", this.resized);
        this.scene.renderer.domElement.removeEventListener(
            "webglcontextlost",
            this.contextLost,
        );
        this.root.remove();
    }
}
