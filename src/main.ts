import "./style.css";
import {
    BODIES,
    PERIODS,
    parentOf,
    parentDistanceKm,
    isSatellite,
    childrenOf,
    extra,
    textureOf,
    sourceDescription,
    physicalOf,
    EXTRA_RINGS,
    BODY_IDS,
    PLANET_IDS,
    sunDistanceKm,
    DAY,
    MAX_TIME,
    MIN_TIME,
    clampTime,
    ephemeris,
    parseUTC,
    phaseName,
    yearBounds,
    dataStatus,
    ASTRO_BODY,
    type BodyId,
    type ScaleMode,
} from "./model";
import { Libration, RotationAxis } from "astronomy-engine";
import { SolarScene } from "./scene";
import { SolarTour } from "./tour";
import { initCatalogs, catalogRequest } from "./catalogs";
import { keplerPosition } from "./kepler";
import type { CatalogObject, DataCompleteness } from "./catalog-types";
import {
    MINOR_MOONS,
    MINOR_MOON_BY_ID,
    isMinorMoon,
    orbitAccuracy,
    relativePosition,
    type OrbitTarget,
} from "./minor-moons";
import minorMoonData from "./minor-moons.json";
import {
    OBSERVATORY_SITES,
    formatDeclination,
    formatRightAscension,
    observe,
    starsForSky,
    type ObservatorySite,
} from "./observatory";

const paths: Record<string, string> = {
    orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/>',
    grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
    play: '<path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
    back: '<path d="m14 5-7 7 7 7"/><path d="M19 5v14"/>',
    next: '<path d="m10 5 7 7-7 7"/><path d="M5 5v14"/>',
    reset: '<path d="M4 8a9 9 0 1 1-1 7M4 3v5h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    link: '<path d="m10 13 4-4m-5 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1"/>',
    reverse: '<path d="M5 5v14m13-14L6 12l12 7Z"/>',
};
const icon = (name: string) =>
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
const ids = BODY_IDS;
const minorMoons = minorMoonData.bodies;
const DATA_STATUS_LABEL: Record<DataCompleteness, string> = {
    "full-model": "模型/贴图",
    "orbit-point": "轨道点",
    "catalog-only": "目录记录",
    "name-only": "仅名称",
};
const OBSERVATORY_TARGET_IDS: BodyId[] = ["sun", ...PLANET_IDS, "moon"];
const statusLabel = (status: DataCompleteness) => DATA_STATUS_LABEL[status];
const accuracyLabel = (target: OrbitTarget, at: number) => {
    if (!isMinorMoon(target)) return "解析星历";
    const accuracy = orbitAccuracy(target, at);
    return accuracy === "near-epoch"
        ? "接近 SPICE 历元"
        : accuracy === "extended"
          ? "开普勒扩展"
          : "远离历元 · 仅轨道形态";
};
const params = new URLSearchParams(location.search);
let selected: BodyId = ids.includes(params.get("body") as BodyId)
    ? (params.get("body") as BodyId)
    : "earth";
let mode: ScaleMode =
    params.get("scale") === "physical" ? "physical" : "illustrated";
const requestedTime = Number(params.get("time"));
let time =
    params.has("time") && Number.isFinite(requestedTime)
        ? clampTime(requestedTime)
        : clampTime(Date.now());
let playing = false,
    reverse = false,
    speed = 3600,
    overview = params.get("view") === "system",
    family = params.get("view") === "family";
let catalogState = params.get("catalog");
let trackedObject: OrbitTarget | null = null;
let deferredCatalogObject: OrbitTarget | null = null;
let pendingObjectId = params.get("object");
let scene: SolarScene | null = null;
let tour: SolarTour | null = null;
let data = ephemeris(new Date(time));
let fps = 0;
let showOrbits = true,
    showLabels = true,
    showAxis = false,
    showRings = true,
    showMoons = true;
let lastUI = 0,
    lastAstro = 0,
    lastFrame = performance.now(),
    frames = 0,
    fpsStart = lastFrame;
let raf = 0,
    toastTimer: ReturnType<typeof setTimeout>;

q("#app").innerHTML = `
  <header class="header">
    <a class="brand" href="${import.meta.env.BASE_URL}" aria-label="星际之间，返回初始视角"><span class="brand-mark">${icon("orbit")}</span><span>星际之间<small>SOLAR EXPLORER</small></span></a>
    <nav class="top-nav" aria-label="主要导航"><button id="system-nav" class="nav-item">太阳系探索 <span>↗</span></button><span class="nav-divider"></span><span class="edition">行星 · 卫星 · 矮行星 · 小天体</span></nav>
    <div class="header-actions"><span class="local-badge"><i></i>浏览器观测站</span><button id="open-observatory" class="observatory-launch" aria-label="打开地面望远镜观测站">◎ 观测</button><button id="start-tour" class="icon-button tour-launch" aria-label="开始太阳系漫游（F）" title="沉浸漫游 · F">F</button><button id="catalog-shortcut" class="icon-button" aria-label="打开小天体数据目录">${icon("grid")}</button><button id="guide" class="icon-button" aria-label="打开观测指南">${icon("info")}</button><button id="share" class="icon-button" aria-label="复制当前观测链接">${icon("link")}</button></div>
  </header>
  <main>
    <div id="viewport"></div>
    <div class="scene-shade" aria-hidden="true"></div>
    <aside class="catalog" aria-label="天体选择">
      <div class="eyebrow">OUR COSMIC NEIGHBORHOOD</div>
      <h1>从这里，<br>望向宇宙。</h1>
      <p class="intro">从岩石世界，到遥远的冰巨星。</p>
      <div class="catalog-heading"><span>探索天体</span><span id="body-count" class="mono">${ids.length + minorMoons.length}</span></div>
      <p class="catalog-coverage" id="coverage-summary"></p>
      <div class="catalog-filters"><select id="body-filter" aria-label="天体分类"><option value="all">全部天体</option><option value="major">太阳与行星</option><option value="satellite">天然卫星</option><option value="dwarf">五颗矮行星</option><option value="minor">其他小天体</option><option value="full-model">有模型或贴图</option><option value="orbit-point">只有轨道定位</option><option value="catalog-only">只有目录记录</option><option value="name-only">只有名称或资产</option>${["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"].map((id) => `<option value="${id}">${BODIES[id as BodyId].name}系统</option>`).join("")}</select><input id="body-search" type="search" placeholder="搜索天体" aria-label="搜索天体名称"/></div>
      <div class="body-list" tabindex="0" aria-label="天体列表，可滚动">${ids.map((id) => { const status = dataStatus(id); return `<button class="body-card ${id === selected ? "active" : ""}" data-body="${id}" data-status="${status}" aria-pressed="${id === selected}"><span class="planet-thumb ${id}" style="background-color:${BODIES[id].color};${textureOf(id) ? `background-image:url(${import.meta.env.BASE_URL}textures/${textureOf(id)})` : ""}"></span><span class="body-card-text">${BODIES[id].name}<small>${BODIES[id].english} · ${statusLabel(status)}</small></span><span class="body-card-arrow">↗</span></button>`; }).join("")}${minorMoons.map((body) => `<button class="body-card minor-moon-card" data-minor-moon="${body.id}" data-status="orbit-point" aria-pressed="false"><span class="planet-thumb minor-moon" style="background-color:#829b93"></span><span class="body-card-text">${body.name}<small>${body.parent.toUpperCase()} · ${statusLabel("orbit-point")}</small></span><span class="body-card-arrow">↗</span></button>`).join("")}</div>
      <button id="overview" class="overview-button">${icon("grid")}<span>太阳系总览</span>${icon("arrow")}</button>
    </aside>
    <div class="view-heading"><span class="eyebrow" id="view-eyebrow">FOCUS / EARTH</span><span class="view-title" id="view-title">地球近景</span><span class="view-rule"></span><div class="family-actions"><button id="parent-body" hidden></button><button id="family-view" hidden>卫星系统 ↗</button></div></div>
    <div class="canvas-toolbar" aria-label="视角工具"><button id="zoom-in" class="icon-button" aria-label="放大">${icon("plus")}</button><button id="zoom-out" class="icon-button" aria-label="缩小">${icon("minus")}</button><span></span><button id="reset-view" class="icon-button" aria-label="重置当前视角">${icon("focus")}</button></div>
    <aside class="details" aria-label="天体资料">
      <div class="detail-topline"><span class="eyebrow" id="body-kind"></span><span class="detail-index" id="body-number"></span></div>
      <div class="body-title"><h2 id="body-name"></h2><span id="body-english"></span></div>
      <p id="body-description" class="body-description"></p><p id="body-source" class="body-source"></p>
      <dl class="facts"><div><dt id="body-radius-title">参考半径</dt><dd><span id="body-radius"></span><small> km</small></dd></div><div><dt>质量</dt><dd><span id="body-mass"></span><small> kg</small></dd></div><div><dt>自转周期</dt><dd id="body-rotation"></dd></div><div><dt>公转周期</dt><dd id="body-orbit-period"></dd></div><div><dt>温度</dt><dd id="body-temperature"></dd></div><div><dt>平均密度</dt><dd id="body-density"></dd></div></dl><p id="physical-source" class="body-source"></p><p id="ring-source" class="body-source"></p>
      <div class="observation"><div class="eyebrow">此刻的相对位置</div><div class="live-value"><span id="distance-title">距太阳</span><strong id="distance-value"></strong></div><div class="live-value secondary"><span id="secondary-title"></span><span id="secondary-value"></span></div></div>
      <p class="fact-note" id="body-fact"></p><p class="body-source" id="orbit-accuracy"></p>
      <div class="layers"><div class="catalog-heading"><span>观察选项</span><span class="mono">LAYERS</span></div><label><span>轨道路径</span><input type="checkbox" id="orbits" checked/><span class="switch"></span></label><label><span>天体标签</span><input type="checkbox" id="labels" checked/><span class="switch"></span></label><label><span>地球自转轴</span><input type="checkbox" id="axis"/><span class="switch"></span></label><label><span>天然卫星</span><input type="checkbox" id="moons" checked/><span class="switch"></span></label><label><span>行星环</span><input type="checkbox" id="rings" checked/><span class="switch"></span></label><button id="open-catalog" class="catalog-link">小天体数据目录 ↗</button></div>
    </aside>
    <div class="scene-footer"><div class="interaction-hint"><span>左键旋转 · 右键平移</span><i>·</i><span>滚轮缩放</span><i>·</i><span>点击天体探索</span></div><div class="scale-control"><span>尺度</span><div class="segmented" role="group" aria-label="场景比例"><button data-scale="illustrated" aria-pressed="true">展示比例</button><button data-scale="physical" aria-pressed="false">真实比例</button></div><button id="scale-info" class="icon-button" aria-label="了解比例说明">${icon("info")}</button></div></div>
    <section class="timeline" aria-label="时间控制">
      <div class="timeline-top"><div class="clock-block"><span class="eyebrow">模拟时间 <span>UTC</span></span><label class="sr-only" for="date-input">模拟日期与时间（UTC，1900 至 2100 年）</label><input type="datetime-local" id="date-input" min="1900-01-01T00:00" max="2100-12-31T23:59" required/><span id="date-error" class="date-error" role="alert"></span></div>
      <div class="transport"><button id="reverse" class="icon-button" aria-label="切换反向播放" aria-pressed="false">${icon("reverse")}</button><button id="previous-day" class="icon-button" aria-label="后退一天">${icon("back")}</button><button id="play" class="play-button" aria-label="播放模拟">${icon("play")}</button><button id="next-day" class="icon-button" aria-label="前进一天">${icon("next")}</button><label class="sr-only" for="speed">播放速度</label><select id="speed" aria-label="播放速度"><option value="1">实时速度</option><option value="3600" selected>1 小时 / 秒</option><option value="86400">1 天 / 秒</option><option value="604800">7 天 / 秒</option><option value="2592000">30 天 / 秒</option><option value="31557600">1 年 / 秒</option></select></div>
      <div class="timeline-right"><span id="play-state"><i></i>时间已暂停</span><button id="now" class="now-button">${icon("reset")}回到此刻</button></div></div>
      <div class="scrubber"><label class="sr-only" for="time-slider">在当年内调整模拟时间</label><input id="time-slider" type="range" step="3600000"/><div class="month-marks" aria-hidden="true">${["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"].map((s) => `<span>${s}</span>`).join("")}</div></div>
    </section>
  </main>
  <footer class="statusbar"><span><i class="status-dot"></i><span id="fps">正在准备场景</span><span class="status-separator">/</span><span id="scale-caption">天体与距离已调整，便于观察</span></span><button id="about">解析星历 · 数据与说明 ↗</button><span class="version">OPENSPACE WEB STUDY / 05</span></footer>
  <dialog id="catalog-dialog"><div class="dialog-heading"><span class="eyebrow">SMALL BODY CATALOGS</span><button id="close-catalog" class="icon-button" aria-label="关闭小天体目录">${icon("close")}</button></div><h2>小世界，大太阳系。</h2><p>OpenSpace 引用的 16 类 JPL 小天体目录。每类按固定规则抽样绘制，分类之间可能包含同一个天体；完整数据可下载。</p><div class="dataset-controls"><label>目录分类<select id="catalog-category" aria-label="小天体目录分类"></select></label><label class="cloud-toggle"><input id="small-bodies" type="checkbox"/>在场景显示抽样点云</label></div><p id="catalog-summary"></p><p id="catalog-status" role="status">正在读取数据索引…</p><div class="catalog-full-search"><h3>搜索与跟随</h3><p id="catalog-index-info"></p><div class="dataset-controls"><label>名称 / 编号<input id="catalog-search" type="search" placeholder="例如 Eros、433、2024 YR4" maxlength="100"/></label><label>搜索范围<select id="catalog-scope"><option value="current">当前类别</option><option value="all">全部目录</option></select></label></div><button id="catalog-search-submit" class="catalog-link">搜索完整目录 ↗</button><p id="catalog-search-status" role="status"></p><label class="catalog-object-label">天体记录<select id="catalog-object" aria-label="小天体搜索结果"></select></label><div class="dataset-actions"><button id="catalog-prev" disabled>上一页</button><button id="catalog-next" disabled>下一页</button></div><p id="catalog-object-info"></p><button id="catalog-focus" class="primary-button" disabled>定位并跟随 ↗</button></div><p class="guide-footnote">轨道按原始历元的开普勒要素外推；未模拟长期摄动、非引力加速度或彗尾。目录标签“潜在危险”不代表当前存在撞击预警。</p><div class="dataset-actions"><a id="catalog-download" download>下载完整目录</a><button id="catalog-retry">重新加载</button><button id="catalog-overview">查看太阳系总览 ↗</button></div></dialog>
  <dialog id="observatory-dialog" class="observatory-dialog"><div class="dialog-heading"><span class="eyebrow">GROUND OBSERVATORY</span><button id="close-observatory" class="icon-button" aria-label="关闭地面观测站">${icon("close")}</button></div><h2>地面望远镜观测</h2><p>选择地点、目标和 UTC 时间，拖动时间轴查看目标何时适合观测。</p><div class="observatory-time"><label for="observatory-time-slider">模拟时间 <output id="observatory-time-label">--</output></label><input id="observatory-time-slider" type="range" step="900"/><div class="observatory-time-scale"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></div><div class="observatory-layout"><div class="observatory-controls"><div class="observatory-form"><label>观测地点<select id="observatory-site">${OBSERVATORY_SITES.map((site) => `<option value="${site.id}">${site.name}</option>`).join("")}</select></label><label>观测目标<select id="observatory-target-select">${OBSERVATORY_TARGET_IDS.map((id) => `<option value="${id}" ${id === selected ? "selected" : ""}>${BODIES[id].name}</option>`).join("")}</select></label><label>纬度（°）<input id="observatory-lat" type="number" step="0.0001" min="-90" max="90" value="39.9042"/></label><label>经度（°）<input id="observatory-lon" type="number" step="0.0001" min="-180" max="180" value="116.4074"/></label><label>海拔（m）<input id="observatory-height" type="number" step="1" min="0" value="43"/></label></div><details class="observatory-section" open><summary>望远镜参数</summary><div class="observatory-form"><label>口径（mm）<input id="observatory-aperture" type="number" step="1" min="20" value="100"/></label><label>焦距（mm）<input id="observatory-focal-length" type="number" step="1" min="100" value="1000"/></label><label>目镜焦距（mm）<input id="observatory-eyepiece" type="number" step="0.1" min="1" value="25"/></label><label>目视场角（°）<input id="observatory-apparent-field" type="number" step="1" min="20" max="120" value="60"/></label></div></details><details class="observatory-section" open><summary>相机参数</summary><div class="observatory-form"><label>曝光（秒）<input id="observatory-exposure" type="number" step="0.1" min="0.01" value="2"/></label><label>增益<input id="observatory-gain" type="number" step="0.1" min="0" value="1"/></label><label>读出噪声（ADU）<input id="observatory-read-noise" type="number" step="0.1" min="0" value="1.5"/></label><label>视宁度（角秒）<input id="observatory-seeing" type="number" step="0.1" min="0.1" value="1.5"/></label><label>跟踪抖动（角秒）<input id="observatory-jitter" type="number" step="0.1" min="0" value="0.8"/></label><label>光学散射<input id="observatory-scatter" type="number" step="0.05" min="0" max="1" value="0.15"/></label><label>滤镜<select id="observatory-filter"><option value="L">L · 综合色</option><option value="R">R · 红光</option><option value="G">G · 绿光</option><option value="B">B · 蓝光</option><option value="Ha">Hα · 窄带</option></select></label><label>位深<select id="observatory-bit-depth"><option value="8">8 bit</option><option value="12" selected>12 bit</option><option value="16">16 bit</option></select></label></div></details></div><div class="observatory-output"><button id="observatory-solve" class="primary-button">计算当前目标 ↗</button><p id="observatory-target" class="observatory-target"></p><div id="observatory-result" class="observatory-result" role="status"><span>请选择目标并计算</span></div><div id="observatory-sky" class="observatory-sky" hidden><div class="sky-heading"><span>全天空位置预览</span><button id="observatory-track" class="sky-track" aria-pressed="false">跟踪目标</button></div><div class="sky-dome"><div id="observatory-stars" class="sky-stars" aria-hidden="true"></div><span class="sky-cardinal north">N</span><span class="sky-cardinal east">E</span><span class="sky-cardinal south">S</span><span class="sky-cardinal west">W</span><span class="sky-horizon"></span><span id="observatory-fov" class="sky-fov" hidden></span><span id="observatory-crosshair" class="sky-crosshair" aria-hidden="true"></span><span id="observatory-marker" class="sky-marker"><i></i><b id="observatory-marker-label"></b></span></div><p class="sky-caption">背景星点来自 HYG v3.8 亮星目录（星等 ≤ 5.5）；此处显示目标在地平坐标中的位置。生成观测图像时，望远镜会自动指向目标，因此目标位于图像中心；开启跟踪后，目标会随模拟时间保持在中心。</p><button id="observatory-capture" class="sky-capture">生成模拟观测图像</button><div class="observatory-image-panel"><canvas id="observatory-image" class="observatory-image" width="640" height="400" hidden></canvas><p id="observatory-image-note" class="sky-caption" hidden></p><div class="observatory-downloads"><a id="observatory-download" class="sky-capture" download="solarspace-observation.png" hidden>下载 PNG 图像</a><a id="observatory-fits" class="sky-capture" download="solarspace-observation.fits" hidden>下载 FITS 图像</a></div></div></div></div></div><p class="guide-footnote">第一版使用 Astronomy Engine 的地面观测模型；小天体目录对象暂不参与精确地平坐标计算。大气折射采用标准模型。</p></dialog>
  <div id="toast" role="status" class="toast" hidden></div>
  <dialog id="guide-dialog"><div class="dialog-heading"><span class="eyebrow">FIELD GUIDE</span><button id="close-guide" class="icon-button" aria-label="关闭观测指南">${icon("close")}</button></div><h2>开始你的宇宙探索</h2><p>选择一个天体，从熟悉的世界出发。按 F 或点击顶栏 F 按钮，进入约 11 分钟的全屏太阳系漫游；空格暂停，N 显示讲解，Esc 退出。漫游保持当前模拟日期，退出后恢复原视角与播放状态。</p><div class="guide-grid"><div><b>01 / 观察</b><p>左键拖动旋转视角，右键拖动平移，滚轮缩放；触屏单指旋转、双指平移与缩放。按 R 或点击重置可重新居中。点击三维天体、标签或左侧列表，即可跟随观察。也可使用右侧的放大、缩小按钮。</p></div><div><b>02 / 时间</b><p>播放或倒放天体运动，选择速度，拖动年度时间线，或直接输入 UTC 日期。支持 1900—2100 年。空格暂停 / 播放，1—8 按距日顺序选择行星，0 选择太阳，9 选择月球，R 重置视角。</p></div><div><b>03 / 尺度</b><p>展示比例压缩行星间距、地月距离及巨行星与太阳的大小，让整个太阳系更易观察。天体方向保留，尺寸与间距不按同一比例。真实比例统一使用同一比例尺，天体可能小到难以看见，请用天体列表定位。</p></div><div><b>04 / 模型与数据</b><p>位置由 Astronomy Engine 解析星历计算，使用 J2000 黄道坐标与 IAU 自转模型。轨道线是所选时刻附近一个周期的采样参考；不是航天导航或日月食预测工具。主要卫星已提取 OpenSpace SPICE 在 2026-09-10 的轨道状态，用开普勒模型外推；木星四大卫星采用解析模型。远离历元会有相位误差，不能用于预测食现象。</p></div></div><p class="guide-footnote">新增七颗行星的尺寸与贴图、土星环的范围和纹理来自本项目 OpenSpace 资产定义及其资源服务器；贴图已缩小并转换为浏览器格式。地球、月球沿用 Three.js 示例纹理，太阳为程序化示意。土星环光照与阴影为简化模型，未模拟颗粒或精确散射。新增卫星、矮行星沿用原项目影像或模型；缺少全球影像的天体使用纯色形状示意。部分原资产的尺寸按同项目 NASA 参数核校正。新增木星、天王星、海王星环使用 NASA PDS 参数，亮度与展示比例下的细环宽度经过增强；没有模拟环弧。卫星物理资料补充自 JPL，平均半径估计与三轴形状分别说明。完整小天体目录支持名称/编号搜索、定位与跟随。详细来源见工程资源说明。</p><button id="start-explore" class="primary-button">继续探索 ${icon("arrow")}</button></dialog>
`;

function toast(message: string) {
    clearTimeout(toastTimer);
    q("#toast").textContent = message;
    q("#toast").hidden = false;
    toastTimer = setTimeout(() => {
        q("#toast").hidden = true;
    }, 4200);
}
function updateLink() {
    if (tour?.active) return;
    const url = new URL(location.href);
    url.search = new URLSearchParams({
        body: selected,
        time: String(Math.round(time)),
        scale: mode,
        view: overview ? "system" : family ? "family" : "focus",
        ...(catalogState ? { catalog: catalogState } : {}),
        ...(isMinorMoon(trackedObject)
            ? { moon: trackedObject.id }
            : trackedObject?.id || pendingObjectId
              ? { object: trackedObject?.id || pendingObjectId! }
              : {}),
    }).toString();
    history.replaceState(null, "", url);
}
function syncTime(force = false) {
    const date = new Date(time);
    if (document.activeElement !== q("#date-input") || force)
        q<HTMLInputElement>("#date-input").value = date
            .toISOString()
            .slice(0, 16);
    const [min, max] = yearBounds(date),
        slider = q<HTMLInputElement>("#time-slider");
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(time);
    slider.setAttribute(
        "aria-valuetext",
        `${date.toISOString().slice(0, 10)} UTC`,
    );
    slider.style.setProperty(
        "--progress",
        `${((time - min) / (max - min)) * 100}%`,
    );
    if (trackedObject?.orbit) {
        const distanceAU = isMinorMoon(trackedObject)
            ? Math.hypot(...relativePosition(trackedObject, time))
            : Math.hypot(...keplerPosition(trackedObject.orbit, time));
        if (isMinorMoon(trackedObject)) {
            const parentKm =
                Math.hypot(...relativePosition(trackedObject, time)) *
                149597870.7;
            q("#distance-title").textContent =
                `距${BODIES[trackedObject.parentBody].name}`;
            q("#distance-value").textContent =
                `${Math.round(parentKm).toLocaleString("zh-CN")} km`;
        } else {
            q("#distance-title").textContent = "距太阳";
            q("#distance-value").textContent = `${distanceAU.toFixed(5)} AU`;
        }
        q("#secondary-title").textContent = "阳光抵达这里";
        q("#secondary-value").textContent =
            `${((distanceAU * 499.0048) / 60).toFixed(1)} 分钟`;
        q("#orbit-accuracy").textContent = `轨道精度提示：${accuracyLabel(trackedObject, time)}。${isMinorMoon(trackedObject) && orbitAccuracy(trackedObject, time) === "far" ? "当前日期远离 SPICE 历元，位置仅用于形态观察。" : ""}`;
        return;
    }
    q("#orbit-accuracy").textContent = "";
    const distanceKm = isSatellite(selected)
        ? parentDistanceKm(data, selected)
        : selected === "sun"
          ? data.earthSunKm
          : sunDistanceKm(data, selected);
    q("#distance-title").textContent = isSatellite(selected)
        ? `距${BODIES[parentOf(selected)!].name}`
        : selected === "sun"
          ? "距地球"
          : "距太阳";
    q("#distance-value").textContent = isSatellite(selected)
        ? `${Math.round(distanceKm).toLocaleString("zh-CN")} km`
        : `${(distanceKm / 1e8).toFixed(4)} 亿 km`;
    const lightSeconds = Math.round(
        (isSatellite(selected) ? sunDistanceKm(data, selected) : distanceKm) /
            299792.458,
    );
    const lightTime =
        lightSeconds >= 3600
            ? `${Math.floor(lightSeconds / 3600)} 小时 ${Math.floor((lightSeconds % 3600) / 60)} 分`
            : `${Math.floor(lightSeconds / 60)} 分 ${lightSeconds % 60} 秒`;
    q("#secondary-title").textContent =
        selected === "moon"
            ? "地球上所见月相"
            : selected === "earth"
              ? "距月球"
              : selected === "sun"
                ? "阳光抵达地球"
                : "阳光抵达这里";
    q("#secondary-value").textContent =
        selected === "moon"
            ? `${phaseName(data.phase)} · ${Math.round((1 - Math.cos((data.phase * Math.PI) / 180)) * 50)}% 照明`
            : selected === "earth"
              ? `${Math.round(data.earthMoonKm).toLocaleString("zh-CN")} km`
              : lightTime;
    if (q<HTMLDialogElement>("#observatory-dialog")?.open) solveObservatory();
}
function refreshData() {
    data = ephemeris(new Date(time));
    scene?.update(data, new Date(time), mode);
    syncTime();
}
function updateSelection() {
    q(".details").scrollTop = 0;
    q(".details").classList.toggle("catalog-details", Boolean(trackedObject));
    if (isMinorMoon(trackedObject)) {
        const body = trackedObject;
        q("#body-name").textContent = body.name;
        q("#body-english").textContent = body.english;
        q("#body-kind").textContent = "天然卫星 · 轨道定位";
        q("#body-number").textContent = "OpenSpace";
        q("#body-description").textContent =
            `围绕${BODIES[body.parentBody].name}运行的小卫星，使用本项目 OpenSpace SPICE 状态的开普勒近似外推。`;
        q("#body-source").textContent = "OpenSpace SPICE / JPL";
        q("#body-orbit-period").textContent =
            `${body.orbit.period.toFixed(body.orbit.period < 1 ? 3 : 2)} 天`;
        const physical = body.physical;
        q("#body-radius").textContent = physical?.meanRadiusKm
            ? physical.meanRadiusKm.toLocaleString("zh-CN")
            : "定位点";
        q("#body-mass").textContent = physical?.massKg
            ? physical.massKg.toExponential(3).replace("e+", " × 10^")
            : "未收录";
        q("#body-density").textContent = physical?.densityGcm3
            ? `${physical.densityGcm3} ± ${physical.densitySigma ?? "?"} g/cm³`
            : "未收录";
        q("#body-radius").nextElementSibling!.toggleAttribute("hidden", !physical?.meanRadiusKm);
        q("#body-mass").nextElementSibling!.toggleAttribute("hidden", !physical?.massKg);
        q("#body-radius-title").textContent = physical?.meanRadiusKm
            ? "平均半径"
            : "参考半径";
        q("#body-fact").textContent =
            `数据完整度：${statusLabel(body.dataStatus)} · ${accuracyLabel(body, time)} · 母行星：${BODIES[body.parentBody].name} · 数据历元 ${body.sourceEpoch.slice(0, 10)} · 来源内核 ${body.sourceUrl.split("/").pop()}。${physical ? "物理参数来自 JPL 卫星物理参数表；" : "未收录物理参数；"}未加载表面纹理。`;
        for (const key of [
            "radius",
            "mass",
            "rotation",
            "temperature",
            "density",
        ])
            q(`#body-${key}`).textContent = "未收录";
        q("#body-radius-title").textContent = "参考半径";
        q("#body-radius").textContent = "定位点";
        q("#body-radius").nextElementSibling!.setAttribute("hidden", "");
        q("#body-mass").nextElementSibling!.setAttribute("hidden", "");
        q("#physical-source").replaceChildren();
        if (physical) {
            const link = document.createElement("a");
            link.href = physical.source.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "JPL 物理参数来源 ↗";
            q("#physical-source").append("平均半径、质量与密度；", link);
        }
        q("#ring-source").textContent = "";
        q("#parent-body").hidden = false;
        q("#parent-body").textContent = `返回${BODIES[body.parentBody].name} ↗`;
        q("#family-view").hidden = false;
        q("#family-view").textContent =
            `${BODIES[body.parentBody].name}卫星系统 ↗`;
        q("#view-title").textContent = `${body.name} · 轨道跟随`;
        q("#view-eyebrow").textContent = "MOON / FOLLOW";
        document
            .querySelectorAll<HTMLButtonElement>("[data-body]")
            .forEach((b) => {
                b.classList.remove("active");
                b.setAttribute("aria-pressed", "false");
            });
        document
            .querySelectorAll<HTMLButtonElement>("[data-minor-moon]")
            .forEach((b) => {
                const a = b.dataset.minorMoon === body.id;
                b.classList.toggle("active", a);
                b.setAttribute("aria-pressed", String(a));
            });
        q("#overview").classList.remove("active");
        syncTime();
        return;
    }
    if (trackedObject?.orbit) {
        const body = trackedObject;
        for (const key of [
            "radius",
            "mass",
            "rotation",
            "temperature",
            "density",
        ])
            q(`#body-${key}`).textContent = "未收录";
        q("#body-radius-title").textContent = "参考半径";
        q("#body-radius").textContent = "定位点";
        q("#body-radius").nextElementSibling!.setAttribute("hidden", "");
        q("#body-mass").nextElementSibling!.setAttribute("hidden", "");
        q("#body-name").textContent = body.name;
        q("#body-english").textContent = "SMALL BODY";
        q("#body-kind").textContent = "完整小天体目录";
        q("#body-number").textContent = "SBDB";
        q("#body-description").textContent =
            "当前跟随此天体的轨道位置。时间控制可播放运动，右键拖动可平移视角。";
        q("#body-source").textContent =
            `OpenSpace / JPL SBDB · ${body.sourceCategory}`;
        q("#body-orbit-period").textContent =
            `${body.orbit!.period.toFixed(2)} 天`;
        q("#body-fact").textContent =
            `数据完整度：${statusLabel(body.dataStatus ?? "orbit-point")} · 历元 ${new Date(body.orbit!.epoch).toISOString().slice(0, 10)} · 开普勒近似外推。亮点仅表示位置，不代表实测大小；未加载地貌或彗尾。`;
        q("#physical-source").textContent = "";
        q("#ring-source").textContent = "";
        q("#parent-body").hidden = q("#family-view").hidden = true;
        q("#view-title").textContent = `${body.name} · 轨道跟随`;
        q("#view-eyebrow").textContent = "CATALOG / FOLLOW";
        document.documentElement.style.setProperty("--body-color", "#e6c28b");
        document
            .querySelectorAll<HTMLButtonElement>("[data-body]")
            .forEach((button) => {
                button.classList.remove("active");
                button.setAttribute("aria-pressed", "false");
            });
        q("#overview").classList.remove("active");
        syncTime();
        return;
    }
    const body = BODIES[selected];
    for (const key of [
        "name",
        "english",
        "description",
        "radius",
        "mass",
        "rotation",
        "temperature",
        "fact",
        "kind",
        "number",
    ] as const)
        q(`#body-${key}`).textContent = body[key];
    document.documentElement.style.setProperty("--body-color", body.color);
    document
        .querySelectorAll<HTMLButtonElement>("[data-body]")
        .forEach((button) => {
            const active = button.dataset.body === selected;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    q("#body-source").textContent = sourceDescription(selected);
    q("#body-orbit-period").textContent =
        selected === "sun" ? "—" : `${PERIODS[selected].toFixed(2)} 天`;
    q("#body-mass").nextElementSibling!.toggleAttribute(
        "hidden",
        BODIES[selected].mass === "未收录",
    );
    q("#body-radius").nextElementSibling!.toggleAttribute(
        "hidden",
        extra(selected)?.radiusQuality === "placeholder",
    );
    q("#body-radius-title").textContent =
        extra(selected)?.radiusQuality === "mean-estimate"
            ? "平均半径估计"
            : "参考半径";
    const physical = physicalOf(selected);
    q("#body-density").textContent = physical?.densityGcm3
        ? `${physical.densityGcm3} ± ${physical.densitySigma} g/cm³`
        : "未收录";
    q("#physical-source").replaceChildren();
    if (physical) {
        const link = document.createElement("a");
        link.href = physical.source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "JPL 物理参数来源 ↗";
        q("#physical-source").append(
            `平均半径 ${physical.meanRadiusKm} ± ${physical.meanRadiusSigmaKm} km；质量由 GM 换算${physical.massUpperLimit ? "，所列为上限" : ""}。`,
            link,
        );
        q("#physical-source").title = physical.radiusReference;
    }
    const ring = EXTRA_RINGS[selected as keyof typeof EXTRA_RINGS];
    q("#ring-source").replaceChildren();
    if (ring) {
        const link = document.createElement("a");
        link.href = ring.source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "环参数来源 ↗";
        q("#ring-source").append(ring.note + "。", link);
    }
    const parent = parentOf(selected);
    q("#parent-body").hidden = !isSatellite(selected);
    q("#parent-body").textContent = parent
        ? `返回${BODIES[parent].name} ↗`
        : "";
    q("#family-view").hidden = !childrenOf(selected).some(isSatellite);
    if (q<HTMLButtonElement>(`[data-body="${selected}"]`).hidden) {
        q<HTMLSelectElement>("#body-filter").value = "all";
        q<HTMLInputElement>("#body-search").value = "";
        filterBodies();
    }
    q(`[data-body="${selected}"]`).scrollIntoView({
        block: "nearest",
        inline: "nearest",
    });
    q("#view-eyebrow").textContent = overview
        ? "OVERVIEW / SOLAR SYSTEM"
        : `FOCUS / ${body.english}`;
    q("#view-title").textContent = overview
        ? "太阳系总览"
        : family
          ? `${body.name}与卫星系统`
          : body.caption;
    q("#overview").classList.toggle("active", overview);
    syncTime();
}
function selectBody(id: BodyId) {
    if (tour?.active) return;
    trackedObject = null;
    pendingObjectId = null;
    selected = id;
    overview = false;
    family = false;
    scene?.focus(id);
    updateSelection();
    updateLink();
}
function setPlaying(value: boolean) {
    playing = value;
    q("#play").innerHTML = icon(playing ? "pause" : "play");
    q("#play").setAttribute("aria-label", playing ? "暂停模拟" : "播放模拟");
    q("#play-state").innerHTML =
        `<i></i>${playing ? (reverse ? "时间反向推演" : "时间向前推演") : "时间已暂停"}`;
    q("#play-state").classList.toggle("running", playing);
}
function setTime(next: number, pause = false) {
    time = clampTime(next);
    if (pause) setPlaying(false);
    q("#date-error").textContent = "";
    q<HTMLInputElement>("#date-input").setCustomValidity("");
    refreshData();
    syncTime(true);
    updateLink();
}
function setMode(next: ScaleMode) {
    const changed = mode !== next;
    mode = next;
    document
        .querySelectorAll<HTMLButtonElement>("[data-scale]")
        .forEach((button) => {
            button.setAttribute(
                "aria-pressed",
                String(button.dataset.scale === mode),
            );
        });
    q("#scale-caption").textContent =
        mode === "physical"
            ? "天体半径与距离使用统一比例尺"
            : "天体与距离已调整，便于观察";
    scene?.update(data, new Date(time), mode);
    updateLink();
    if (changed)
        toast(
            mode === "physical"
                ? "已使用真实比例。用左侧列表定位较小的天体。"
                : "已切换展示比例，天体大小与距离已调整。",
        );
}

try {
    scene = new SolarScene(
        q("#viewport"),
        selectBody,
        (file) => toast(`纹理 ${file} 加载失败，请刷新重试。`),
        (id) => focusMinorMoon(id),
    );
    scene.update(data, new Date(time), mode);
    scene.focus(overview ? "system" : selected, false, family);
    scene.renderer.domElement.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        setPlaying(false);
        toast("图形上下文暂时丢失，正在等待恢复。");
    });
    scene.renderer.domElement.addEventListener("webglcontextrestored", () => {
        refreshData();
        toast("三维场景已恢复。");
    });
} catch (error) {
    console.error(error);
    q("#viewport").innerHTML =
        `<div class="webgl-error"><h2>三维场景暂时无法启动</h2><p>请使用支持 WebGL2 的现代浏览器，并开启图形加速。你仍可查看天体资料与时间数据。</p><button onclick="location.reload()" class="primary-button">重新加载</button></div>`;
    q("#fps").textContent = "三维渲染不可用";
}
function filterBodies() {
    const group = q<HTMLSelectElement>("#body-filter").value;
    const keyword = q<HTMLInputElement>("#body-search")
        .value.trim()
        .toLowerCase();
    let count = 0;
    for (const id of ids) {
        const matchesGroup =
            group === "all" ||
            (group === "major"
                ? !extra(id) && !isSatellite(id)
                : group === "satellite"
                  ? isSatellite(id)
                  : group === "dwarf" || group === "minor"
                    ? extra(id)?.category === group
                    : group === "full-model" || group === "orbit-point" || group === "name-only"
                      ? dataStatus(id) === group
                    : id === group || parentOf(id) === group);
        const matchesText = `${BODIES[id].name} ${id}`
            .toLowerCase()
            .includes(keyword);
        q<HTMLButtonElement>(`[data-body="${id}"]`).hidden = !(
            matchesGroup && matchesText
        );
        if (matchesGroup && matchesText) count++;
    }
    for (const moon of MINOR_MOONS) {
        const matchesGroup =
            group === "all" ||
            group === "satellite" ||
            group === "minor" ||
            group === "orbit-point" ||
            group === moon.parentBody;
        const matchesStatus =
            group === "orbit-point" || group === "all" || group === "satellite" || group === "minor" || group === moon.parentBody;
        const matchesText =
            `${moon.name} ${moon.english} ${moon.id} ${BODIES[moon.parentBody].name}`
                .toLowerCase()
                .includes(keyword);
        q<HTMLButtonElement>(`[data-minor-moon="${moon.id}"]`).hidden = !(
            matchesGroup && matchesStatus && matchesText
        );
        if (matchesGroup && matchesStatus && matchesText) count++;
    }
    q("#body-count").textContent =
        `${count} / ${ids.length + MINOR_MOONS.length}`;
}
q("#body-filter").addEventListener("change", filterBodies);
q("#body-search").addEventListener("input", filterBodies);
q("#parent-body").addEventListener("click", () => {
    if (isMinorMoon(trackedObject)) selectBody(trackedObject.parentBody);
    else if (parentOf(selected)) selectBody(parentOf(selected)!);
});
q("#family-view").addEventListener("click", () => {
    if (isMinorMoon(trackedObject)) {
        const parent = trackedObject.parentBody;
        trackedObject = null;
        pendingObjectId = null;
        selected = parent;
    }
    family = true;
    overview = false;
    scene?.focus(selected, true, true);
    updateSelection();
    updateLink();
});
q("#catalog-overview").addEventListener("click", () => {
    q<HTMLDialogElement>("#catalog-dialog").close();
    q<HTMLButtonElement>("#overview").click();
});
function focusCatalog(body: OrbitTarget) {
    if (tour?.active) {
        deferredCatalogObject = body;
        return;
    }
    if (!body.orbit) {
        toast("此记录暂不支持椭圆轨道定位。");
        return;
    }
    pendingObjectId = null;
    trackedObject = body;
    overview = false;
    family = false;
    scene?.focusCatalog(body);
    updateSelection();
    updateLink();
}
function focusMinorMoon(id: string) {
    const moon = MINOR_MOON_BY_ID.get(id);
    if (moon) {
        selected = moon.parentBody;
        focusCatalog(moon);
    }
}
void initCatalogs(
    scene,
    catalogState,
    (id) => {
        catalogState = id;
        updateLink();
    },
    focusCatalog,
);
filterBodies();
{
    const counts = ids.reduce<Record<DataCompleteness, number>>(
        (acc, id) => { acc[dataStatus(id)]++; return acc; },
        { "full-model": 0, "orbit-point": 0, "catalog-only": 0, "name-only": 0 },
    );
    counts["orbit-point"] += MINOR_MOONS.length;
    q("#coverage-summary").textContent =
        `${counts["full-model"]} 个模型/贴图 · ${counts["orbit-point"]} 个轨道定位点 · ${counts["name-only"] + counts["catalog-only"]} 个仅资料记录`;
}
updateSelection();
setMode(mode);

document
    .querySelectorAll<HTMLButtonElement>("[data-body]")
    .forEach((button) =>
        button.addEventListener("click", () =>
            selectBody(button.dataset.body as BodyId),
        ),
    );
document
    .querySelectorAll<HTMLButtonElement>("[data-minor-moon]")
    .forEach((button) =>
        button.addEventListener("click", () =>
            focusMinorMoon(button.dataset.minorMoon!),
        ),
    );
document
    .querySelectorAll<HTMLButtonElement>("[data-scale]")
    .forEach((button) =>
        button.addEventListener("click", () =>
            setMode(button.dataset.scale as ScaleMode),
        ),
    );
for (const id of ["overview", "system-nav"])
    q(`#${id}`).addEventListener("click", () => {
        trackedObject = null;
        pendingObjectId = null;
        overview = true;
        family = false;
        scene?.focus("system");
        updateSelection();
        updateLink();
    });
q("#play").addEventListener("click", () => setPlaying(!playing));
q("#reverse").addEventListener("click", () => {
    reverse = !reverse;
    q("#reverse").setAttribute("aria-pressed", String(reverse));
    setPlaying(playing);
});
q<HTMLSelectElement>("#speed").addEventListener("change", (event) => {
    speed = Number((event.target as HTMLSelectElement).value);
});
q("#previous-day").addEventListener("click", () => setTime(time - DAY, true));
q("#next-day").addEventListener("click", () => setTime(time + DAY, true));
q("#now").addEventListener("click", () => setTime(Date.now(), true));
q("#zoom-in").addEventListener("click", () => scene?.zoom(0.8));
q("#zoom-out").addEventListener("click", () => scene?.zoom(1.25));
q("#reset-view").addEventListener("click", () => scene?.reset());
q("#time-slider").addEventListener("input", (event) =>
    setTime(Number((event.target as HTMLInputElement).value), true),
);
q<HTMLInputElement>("#date-input").addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement,
        next = parseUTC(input.value);
    if (next === null) {
        input.setCustomValidity("请输入 1900—2100 年之间的有效 UTC 时间");
        q("#date-error").textContent = "请输入 1900—2100 年之间的有效日期";
        setPlaying(false);
        return;
    }
    setTime(next, true);
});
for (const id of ["orbits", "labels", "axis", "rings", "moons"])
    q(`#${id}`).addEventListener("change", () => {
        showOrbits = q<HTMLInputElement>("#orbits").checked;
        showLabels = q<HTMLInputElement>("#labels").checked;
        showAxis = q<HTMLInputElement>("#axis").checked;
        showRings = q<HTMLInputElement>("#rings").checked;
        showMoons = q<HTMLInputElement>("#moons").checked;
        scene?.setLayers(
            showOrbits,
            showLabels,
            showAxis,
            showRings,
            showMoons,
        );
    });
const dialog = q<HTMLDialogElement>("#guide-dialog");
for (const id of ["guide", "about", "scale-info"])
    q(`#${id}`).addEventListener("click", () => dialog.showModal());
for (const id of ["close-guide", "start-explore"])
    q(`#${id}`).addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        )
            dialog.close();
    }
});
let observatorySite: ObservatorySite = OBSERVATORY_SITES[0];
let observatoryTracking = false;
let observatoryStarsKey = "";
const observationTextureCache = new Map<string, HTMLImageElement | null>();
const BODY_ROTATION_DAYS: Partial<Record<BodyId, number>> = {
    mercury: 58.646,
    venus: -243.025,
    moon: 27.321661,
    mars: 1.026,
    jupiter: 0.4135,
    saturn: 0.444,
    uranus: -0.718,
    neptune: 0.6713,
    pluto: 6.387,
};
function updateObservatorySite(site: ObservatorySite) {
    observatorySite = site;
    q<HTMLInputElement>("#observatory-lat").value = String(site.latitude);
    q<HTMLInputElement>("#observatory-lon").value = String(site.longitude);
    q<HTMLInputElement>("#observatory-height").value = String(site.heightMeters);
}
function syncObservatoryTimeAxis() {
    const date = new Date(time);
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const slider = q<HTMLInputElement>("#observatory-time-slider");
    slider.min = String(start);
    slider.max = String(start + 86_400_000 - 900);
    slider.value = String(Math.max(start, Math.min(start + 86_400_000 - 900, time)));
    const local = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    q("#observatory-time-label").textContent = `${date.toISOString().slice(0, 16).replace("T", " ")} UTC · 北京 ${local}`;
}
async function observationTexture(target: BodyId): Promise<HTMLImageElement | null> {
    if (target === "sun") return null;
    if (observationTextureCache.has(target)) return observationTextureCache.get(target)!;
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}textures/${target}.jpg`;
    try {
        await image.decode();
        observationTextureCache.set(target, image);
        return image;
    } catch {
        observationTextureCache.set(target, null);
        return null;
    }
}
function formatFieldDegrees(degrees: number): string {
    if (degrees < 0.01) return degrees.toPrecision(2);
    if (degrees < 1) return degrees.toFixed(3);
    return degrees.toFixed(2);
}
async function renderObservatoryImage(result: ReturnType<typeof observe>, site: ObservatorySite) {
    if (!result) return;
    const canvas = q<HTMLCanvasElement>("#observatory-image");
    const context = canvas.getContext("2d");
    if (!context) return;
    const focalLength = Number(q<HTMLInputElement>("#observatory-focal-length").value);
    const eyepiece = Number(q<HTMLInputElement>("#observatory-eyepiece").value);
    const apparentField = Number(q<HTMLInputElement>("#observatory-apparent-field").value);
    const exposure = Math.max(0.01, Number(q<HTMLInputElement>("#observatory-exposure").value) || 1);
    const gain = Math.max(0, Number(q<HTMLInputElement>("#observatory-gain").value) || 0);
    const readNoise = Math.max(0, Number(q<HTMLInputElement>("#observatory-read-noise").value) || 0);
    const seeingArcsec = Math.max(0.1, Number(q<HTMLInputElement>("#observatory-seeing").value) || 1.5);
    const jitterArcsec = Math.max(0, Number(q<HTMLInputElement>("#observatory-jitter").value) || 0);
    const scatter = Math.max(0, Math.min(1, Number(q<HTMLInputElement>("#observatory-scatter").value) || 0));
    const filter = q<HTMLSelectElement>("#observatory-filter").value;
    const bitDepth = Number(q<HTMLSelectElement>("#observatory-bit-depth").value) || 12;
    const filterColor = filter === "R" ? "#ffb0a0" : filter === "G" ? "#c8ffd0" : filter === "B" ? "#b8d6ff" : filter === "Ha" ? "#ff8b8b" : "#d9eaff";
    const dynamicRange = Math.pow(2, bitDepth) - 1;
    const magnification = focalLength > 0 && eyepiece > 0 ? focalLength / eyepiece : 40;
    const fieldDeg = Math.max(0.000001, Math.min(120, apparentField / magnification));
    const daylight = Math.max(0, Math.min(1, (result.sunAltitudeDeg + 18) / 60));
    const pollution = Math.max(0, Math.min(1, (21.7 - site.skyBrightnessMag) / 5));
    context.fillStyle = `rgb(${2 + daylight * 10 + pollution * 8}, ${5 + daylight * 12 + pollution * 7}, ${12 + daylight * 18 + pollution * 5})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const stars = starsForSky(new Date(time), site);
    for (const star of stars) {
        let deltaAz = star.azimuthDeg - result.azimuthDeg;
        while (deltaAz > 180) deltaAz -= 360;
        while (deltaAz < -180) deltaAz += 360;
        const x = canvas.width / 2 + (deltaAz / fieldDeg) * canvas.width;
        const y = canvas.height / 2 - ((star.altitudeDeg - result.altitudeDeg) / fieldDeg) * canvas.height;
        if (x < -4 || x > canvas.width + 4 || y < -4 || y > canvas.height + 4) continue;
        const extinction = result.airmass === null ? 1 : Math.pow(10, -0.4 * 0.2 * Math.max(0, result.airmass - 1));
        const rawSignal = (1.3 - star.magnitude * 0.13) * Math.sqrt(exposure * Math.max(0.2, gain)) * extinction;
        const intensity = Math.max(0.08, Math.min(1, 1 - Math.exp((-rawSignal * dynamicRange) / 1800)));
        const seeingPixels = (seeingArcsec / 3600 / fieldDeg) * canvas.width;
        const radius = Math.max(0.5, Math.min(5, 3.2 - star.magnitude * 0.45 + seeingPixels));
        context.globalAlpha = intensity;
        context.fillStyle = filterColor;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
    }
    context.globalAlpha = 1;
    if (result.aboveHorizon) {
        const jitterPixels = (jitterArcsec / 3600 / fieldDeg) * canvas.width;
        const targetX = canvas.width / 2 + (Math.random() - 0.5) * jitterPixels;
        const targetY = canvas.height / 2 + (Math.random() - 0.5) * jitterPixels;
        const seeingPixels = (seeingArcsec / 3600 / fieldDeg) * canvas.width;
        const targetRadius = Math.max(3, Math.min(canvas.width * 2000, (result.angularDiameterArcsec / 3600 / fieldDeg) * canvas.width * 0.5 + seeingPixels));
        const extinction = result.airmass === null ? 1 : Math.pow(10, -0.4 * 0.2 * Math.max(0, result.airmass - 1));
        const targetSignal = (1.4 - result.visualMagnitude * 0.04) * Math.sqrt(exposure * Math.max(0.2, gain)) * extinction;
        const targetIntensity = Math.max(0.35, Math.min(1, 1 - Math.exp((-targetSignal * dynamicRange) / 1800)));
        const glow = context.createRadialGradient(targetX, targetY, 0, targetX, targetY, targetRadius * 2.5);
        const haloAlpha = targetIntensity * scatter * Math.min(0.12, 0.025 + seeingArcsec * 0.015);
        glow.addColorStop(0, `rgba(240,245,255,${haloAlpha})`);
        glow.addColorStop(1, "rgba(255,224,160,0)");
        context.fillStyle = glow;
        context.fillRect(targetX - targetRadius * 2.5, targetY - targetRadius * 2.5, targetRadius * 5, targetRadius * 5);
        const texture = await observationTexture(result.target);
        if (texture && targetRadius >= 3) {
            // Keep the working texture bounded while retaining the optical scale in
            // the destination rectangle. Extreme focal lengths therefore show a
            // genuinely narrower crop instead of collapsing to the same 105 px dot.
            const diameter = Math.max(8, Math.min(2048, Math.ceil(targetRadius * 2)));
            const surface = document.createElement("canvas");
            surface.width = diameter;
            surface.height = diameter;
            const surfaceContext = surface.getContext("2d")!;
            const rotationDays = BODY_ROTATION_DAYS[result.target] ?? 1;
            let rotation = ((time / 86_400_000) / Math.abs(rotationDays)) * Math.PI * 2 * Math.sign(rotationDays);
            const astroBody = ASTRO_BODY[result.target];
            if (astroBody) {
                rotation = (RotationAxis(astroBody, new Date(time)).spin * Math.PI) / 180;
                if (result.target === "moon") rotation += (Libration(new Date(time)).elon * Math.PI) / 180;
            }
            surfaceContext.translate(diameter / 2, diameter / 2);
            surfaceContext.rotate(rotation);
            surfaceContext.drawImage(texture, -diameter / 2, -diameter / 2, diameter, diameter);
            surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
            const pixels = surfaceContext.getImageData(0, 0, diameter, diameter);
            const phase = result.phaseAngleDeg === null ? 0 : (result.phaseAngleDeg * Math.PI) / 180;
            const sinPhase = Math.sin(phase);
            const cosPhase = Math.cos(phase);
            for (let py = 0; py < diameter; py++) {
                for (let px = 0; px < diameter; px++) {
                    const nx = (px + 0.5 - diameter / 2) / (diameter / 2);
                    const ny = (py + 0.5 - diameter / 2) / (diameter / 2);
                    const sphere = nx * nx + ny * ny;
                    const index = (py * diameter + px) * 4;
                    if (sphere > 1) {
                        pixels.data[index + 3] = 0;
                        continue;
                    }
                    const nz = Math.sqrt(1 - sphere);
                    const lighting = Math.max(0, nx * sinPhase + nz * cosPhase) * (0.72 + 0.28 * nz);
                    pixels.data[index] *= lighting * targetIntensity;
                    pixels.data[index + 1] *= lighting * targetIntensity;
                    pixels.data[index + 2] *= lighting * targetIntensity;
                }
            }
            surfaceContext.putImageData(pixels, 0, 0);
            context.globalAlpha = 1;
            context.drawImage(surface, targetX - targetRadius, targetY - targetRadius, targetRadius * 2, targetRadius * 2);
        } else {
            context.globalAlpha = targetIntensity;
            context.fillStyle = "#fff0c2";
            context.beginPath();
            context.arc(targetX, targetY, targetRadius, 0, Math.PI * 2);
            context.fill();
        }
        context.globalAlpha = 1;
    }
    const noiseCount = Math.round(Math.min(18_000, canvas.width * canvas.height * 0.06 * (readNoise / 3)));
    context.fillStyle = "#dcecff";
    context.globalAlpha = Math.min(0.18, readNoise * 0.025);
    for (let i = 0; i < noiseCount; i++) context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
    context.globalAlpha = 1;
    canvas.hidden = false;
    const download = q<HTMLAnchorElement>("#observatory-download");
    download.href = canvas.toDataURL("image/png");
    download.hidden = false;
    const fits = q<HTMLAnchorElement>("#observatory-fits");
    if (fits.dataset.url) URL.revokeObjectURL(fits.dataset.url);
    const fitsBlob = createFitsBlob(canvas, {
        DATE_OBS: new Date(time).toISOString(),
        OBJECT: BODIES[result.target].english,
        OBS_LAT: site.latitude.toFixed(5),
        OBS_LON: site.longitude.toFixed(5),
        FILTER: filter,
        EXPTIME: exposure.toFixed(3),
    });
    const fitsUrl = URL.createObjectURL(fitsBlob);
    fits.href = fitsUrl;
    fits.dataset.url = fitsUrl;
    fits.hidden = false;
    const note = q<HTMLElement>("#observatory-image-note");
    note.textContent = `模拟图像（自动指向目标） · ${formatFieldDegrees(fieldDeg)}° 视场 · ${exposure.toFixed(2)} s · 增益 ${gain.toFixed(1)} · ${filter} 滤镜 · ${bitDepth} bit · 天空亮度 ${site.skyBrightnessMag.toFixed(1)} mag/arcsec² · 读出噪声 ${readNoise.toFixed(1)} ADU · 视宁度 ${seeingArcsec.toFixed(1)}″ · 抖动 ${jitterArcsec.toFixed(1)}″ · 散射 ${scatter.toFixed(2)}`;
    note.hidden = false;
}
function createFitsBlob(canvas: HTMLCanvasElement, metadata: Record<string, string>): Blob {
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const cards: [string, string, string][] = [
        ["SIMPLE", "                    T", "standard FITS"],
        ["BITPIX", "                   16", "signed 16-bit pixels"],
        ["NAXIS", "                    2", "image dimensions"],
        ["NAXIS1", `${String(canvas.width).padStart(20)}`, "width"],
        ["NAXIS2", `${String(canvas.height).padStart(20)}`, "height"],
        ["BSCALE", `${String(1).padStart(20)}`, "linear scale"],
        ["BZERO", `${String(32768).padStart(20)}`, "unsigned pixel offset"],
    ];
    for (const [key, value] of Object.entries(metadata))
        cards.push([key, `'${value}'`, "metadata"]);
    const header = [...cards.map(([key, value, comment]) => `${key.padEnd(8)}= ${value.padEnd(20)} / ${comment}`), "END"].map((line) => line.padEnd(80).slice(0, 80)).join("");
    const headerBytes = new TextEncoder().encode(header.padEnd(Math.ceil(header.length / 2880) * 2880));
    const pixels = new Uint8Array(Math.ceil(image.data.length / 4) * 2);
    const view = new DataView(pixels.buffer);
    for (let i = 0; i < image.data.length / 4; i++) {
        const offset = i * 4;
        const luminance = 0.2126 * image.data[offset] + 0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2];
        view.setInt16(i * 2, Math.round((luminance / 255) * 65535 - 32768), false);
    }
    const paddedPixels = new Uint8Array(Math.ceil(pixels.length / 2880) * 2880);
    paddedPixels.set(pixels);
    return new Blob([headerBytes, paddedPixels], { type: "application/fits" });
}
function solveObservatory() {
    syncObservatoryTimeAxis();
    const site: ObservatorySite = {
        ...observatorySite,
        latitude: Number(q<HTMLInputElement>("#observatory-lat").value),
        longitude: Number(q<HTMLInputElement>("#observatory-lon").value),
        heightMeters: Number(q<HTMLInputElement>("#observatory-height").value),
    };
    const target = q<HTMLSelectElement>("#observatory-target-select").value as BodyId;
    q("#observatory-target").textContent = target
        ? `当前目标：${BODIES[target].name}`
        : "当前目标：目录小天体暂不支持地平坐标解算";
    if (isMinorMoon(trackedObject) && !OBSERVATORY_TARGET_IDS.includes(selected)) {
        q("#observatory-target").textContent = "当前跟随的是目录小天体，请从观测目标下拉框选择行星或月球。";
    }
    if (!target || !Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) {
        q("#observatory-result").innerHTML = "<span>请选择行星或月球，并填写有效的经纬度。</span>";
        q("#observatory-sky").hidden = true;
        return;
    }
    const result = observe(target, new Date(time), site);
    if (!result) {
        q("#observatory-result").innerHTML = "<span>当前目标没有可用的地面观测星历。</span>";
        q("#observatory-sky").hidden = true;
        return;
    }
    const visibility = result.observable ? "当前可观测" : result.aboveHorizon ? "目标在地平线上方，但太阳高度不满足天文夜条件" : "目标低于地平线";
    const aperture = Number(q<HTMLInputElement>("#observatory-aperture").value);
    const focalLength = Number(q<HTMLInputElement>("#observatory-focal-length").value);
    const eyepiece = Number(q<HTMLInputElement>("#observatory-eyepiece").value);
    const apparentField = Number(q<HTMLInputElement>("#observatory-apparent-field").value);
    const instrumentValid = [aperture, focalLength, eyepiece, apparentField].every((value) => Number.isFinite(value) && value > 0);
    const magnification = instrumentValid ? focalLength / eyepiece : 0;
    const trueField = instrumentValid ? apparentField / magnification : 0;
    const limitingMagnitude = instrumentValid ? 2 + 5 * Math.log10(aperture / 7) : 0;
    const instrumentNote = instrumentValid
        ? `${magnification.toFixed(1)}× · ${formatFieldDegrees(trueField)}° · ${limitingMagnitude.toFixed(1)} 等`
        : "请填写有效的望远镜参数";
    const qualityLabel = result.quality === "good" ? "条件良好" : result.quality === "limited" ? "可以观测，但有限制" : "当前不适合观测";
    const qualityNote = result.qualityNotes.length > 0 ? result.qualityNotes.join(" · ") : "无明显限制";
    const formatEventTime = (event: Date | null) =>
        event
            ? event.toISOString().slice(0, 16).replace("T", " ") + " UTC"
            : "无（极昼/极夜或未找到）";
    q("#observatory-result").innerHTML = `<strong class="observatory-visibility ${result.observable ? "visible" : "hidden"}">${visibility}</strong><p class="observatory-quality ${result.quality}">${qualityLabel}：${qualityNote}</p><dl class="observatory-summary"><div><dt>方位角</dt><dd>${result.azimuthDeg.toFixed(2)}°</dd></div><div><dt>高度角</dt><dd>${result.altitudeDeg.toFixed(2)}°</dd></div><div><dt>最高高度</dt><dd>${result.maxAltitudeDeg.toFixed(1)}°</dd></div><div><dt>视星等</dt><dd>${result.visualMagnitude.toFixed(2)}</dd></div></dl><details class="observatory-more"><summary>更多观测数据</summary><dl><div><dt>赤经 / 赤纬</dt><dd>${formatRightAscension(result.rightAscensionHours)} / ${formatDeclination(result.declinationDeg)}</dd></div><div><dt>距离</dt><dd>${(result.rangeKm / 1e6).toFixed(3)} 百万 km</dd></div><div><dt>光行时</dt><dd>${(result.lightTimeSeconds / 60).toFixed(1)} 分钟</dd></div><div><dt>太阳高度</dt><dd>${result.sunAltitudeDeg.toFixed(2)}°</dd></div><div><dt>角直径</dt><dd>${result.angularDiameterArcsec.toFixed(2)}″</dd></div><div><dt>空气质量</dt><dd>${result.airmass === null ? "—" : result.airmass.toFixed(2)}</dd></div><div><dt>太阳角距</dt><dd>${result.sunSeparationDeg === null ? "—" : `${result.sunSeparationDeg.toFixed(1)}°`}</dd></div><div><dt>月球角距</dt><dd>${result.moonSeparationDeg === null ? "—" : `${result.moonSeparationDeg.toFixed(1)}°`}</dd></div><div><dt>下一次升起</dt><dd>${formatEventTime(result.nextRiseTime)}</dd></div><div><dt>下一次落下</dt><dd>${formatEventTime(result.nextSetTime)}</dd></div><div><dt>望远镜参数</dt><dd>${instrumentNote}</dd></div></dl></details>`;
    const marker = q<HTMLElement>("#observatory-marker");
    const altitude = Math.max(-20, Math.min(90, result.altitudeDeg));
    const trackingActive = observatoryTracking && result.aboveHorizon;
    marker.style.setProperty("--sky-x", trackingActive ? "50%" : `${(result.azimuthDeg / 360) * 100}%`);
    marker.style.setProperty("--sky-y", trackingActive ? "50%" : `${100 - ((altitude + 20) / 110) * 100}%`);
    marker.classList.toggle("below-horizon", !result.aboveHorizon);
    const markerSize = Math.max(7, Math.min(34, 5 + Math.sqrt(result.angularDiameterArcsec) * 0.55));
    const markerBrightness = Math.max(0.45, Math.min(1, 1 - Math.max(-2, result.visualMagnitude) * 0.04));
    marker.style.setProperty("--target-size", `${markerSize}px`);
    marker.style.setProperty("--target-brightness", String(markerBrightness));
    q("#observatory-marker-label").textContent = `${BODIES[target].name} · ${result.azimuthDeg.toFixed(0)}° / ${result.altitudeDeg.toFixed(1)}°`;
    const skyDome = q<HTMLElement>(".sky-dome");
    skyDome.classList.toggle("tracking", trackingActive);
    const starsKey = `${site.latitude.toFixed(4)}:${site.longitude.toFixed(4)}:${Math.floor(time / 3_600_000)}`;
    if (starsKey !== observatoryStarsKey) {
        const stars = starsForSky(new Date(time), site);
        q("#observatory-stars").innerHTML = stars
            .map((star) => {
                const starAltitude = Math.max(0, Math.min(90, star.altitudeDeg));
                const size = Math.max(1, Math.min(3.6, 4.1 - star.magnitude * 0.5));
                const opacity = Math.max(0.28, Math.min(0.95, 1.05 - star.magnitude * 0.12));
                return `<i class="sky-star" style="--star-x:${(star.azimuthDeg / 360) * 100}%;--star-y:${100 - (starAltitude / 110) * 100}%;--star-size:${size}px;--star-opacity:${opacity}" title="HIP ${star.id} · ${star.magnitude.toFixed(1)} 等"></i>`;
            })
            .join("");
        observatoryStarsKey = starsKey;
    }
    const fov = q<HTMLElement>("#observatory-fov");
    const fovSize = Math.max(1, Math.min(72, 72 * Math.sqrt(Math.max(0.000001, trueField) / 60)));
    fov.style.setProperty("--fov-size", `${fovSize}%`);
    fov.hidden = !trackingActive;
    q("#observatory-track").textContent = observatoryTracking ? "停止跟踪" : "跟踪目标";
    q("#observatory-track").setAttribute("aria-pressed", String(observatoryTracking));
    q("#observatory-sky").hidden = false;
}
q<HTMLButtonElement>("#open-observatory").addEventListener("click", () => {
    q<HTMLDialogElement>("#observatory-dialog").showModal();
    const targetSelect = q<HTMLSelectElement>("#observatory-target-select");
    targetSelect.value = OBSERVATORY_TARGET_IDS.includes(selected) ? selected : "moon";
    solveObservatory();
});
q<HTMLButtonElement>("#close-observatory").addEventListener("click", () => q<HTMLDialogElement>("#observatory-dialog").close());
q<HTMLSelectElement>("#observatory-site").addEventListener("change", (event) => {
    const site = OBSERVATORY_SITES.find((item) => item.id === (event.target as HTMLSelectElement).value);
    if (site) updateObservatorySite(site);
});
q<HTMLInputElement>("#observatory-time-slider").addEventListener("input", (event) => {
    setTime(Number((event.target as HTMLInputElement).value), true);
});
q<HTMLButtonElement>("#observatory-solve").addEventListener("click", solveObservatory);
q<HTMLSelectElement>("#observatory-target-select").addEventListener("change", solveObservatory);
for (const id of ["observatory-aperture", "observatory-focal-length", "observatory-eyepiece", "observatory-apparent-field"])
    q<HTMLInputElement>(`#${id}`).addEventListener("change", solveObservatory);
q<HTMLButtonElement>("#observatory-track").addEventListener("click", () => {
    observatoryTracking = !observatoryTracking;
    solveObservatory();
});
q<HTMLButtonElement>("#observatory-capture").addEventListener("click", () => {
    const site: ObservatorySite = {
        ...observatorySite,
        latitude: Number(q<HTMLInputElement>("#observatory-lat").value),
        longitude: Number(q<HTMLInputElement>("#observatory-lon").value),
        heightMeters: Number(q<HTMLInputElement>("#observatory-height").value),
    };
    const target = q<HTMLSelectElement>("#observatory-target-select").value as BodyId;
    void renderObservatoryImage(observe(target, new Date(time), site), site);
});
q("#share").addEventListener("click", async () => {
    updateLink();
    try {
        await navigator.clipboard.writeText(location.href);
        toast("观测链接已复制，包含当前日期、天体与比例。");
    } catch {
        toast("请从浏览器地址栏复制当前观测链接。");
    }
});
document.addEventListener("keydown", (event) => {
    if (tour?.active) return;
    if (
        document.querySelector("dialog[open]") ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement &&
            event.target.isContentEditable) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
    )
        return;
    if (
        event.code === "Space" &&
        !(event.target instanceof HTMLButtonElement)
    ) {
        event.preventDefault();
        setPlaying(!playing);
    }
    if (/^[1-8]$/.test(event.key))
        selectBody(PLANET_IDS[Number(event.key) - 1]);
    if (event.key === "0") selectBody("sun");
    if (event.key === "9") selectBody("moon");
    if (event.key.toLowerCase() === "r") scene?.reset();
});
document.addEventListener("visibilitychange", () => {
    lastFrame = performance.now();
    fpsStart = lastFrame;
    frames = 0;
});

function animate(now: number) {
    raf = requestAnimationFrame(animate);
    if (document.hidden) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    if (playing) {
        const next = time + dt * speed * 1000 * (reverse ? -1 : 1);
        time = clampTime(next);
        if (next < MIN_TIME || next > MAX_TIME) {
            setPlaying(false);
            toast("已到达模型支持的时间边界。");
        }
        if (now - lastAstro > 40) {
            data = ephemeris(new Date(time));
            scene?.update(data, new Date(time), mode);
            lastAstro = now;
        }
    }
    tour?.update(dt);
    scene?.render(dt, now / 1000);
    frames++;
    if (now - fpsStart >= 1000) {
        fps = Math.round((frames * 1000) / (now - fpsStart));
        fpsStart = now;
        frames = 0;
        if (scene) q("#fps").textContent = `${fps} FPS`;
    }
    if (now - lastUI > 200) {
        syncTime();
        lastUI = now;
    }
}
const requestedMoon = params.get("moon");
if (requestedMoon && MINOR_MOON_BY_ID.has(requestedMoon))
    focusMinorMoon(requestedMoon);
if (pendingObjectId && !requestedMoon) {
    const requested = pendingObjectId;
    void catalogRequest<CatalogObject>(
        `object/${encodeURIComponent(requested)}`,
    )
        .then((body) => {
            if (pendingObjectId === requested) focusCatalog(body);
        })
        .catch(() => {
            if (pendingObjectId === requested) {
                pendingObjectId = null;
                updateLink();
                toast("观测链接中的小天体未能加载，请在完整目录重试。");
            }
        });
}
if (scene) {
    tour = new SolarTour(scene, () => {
        const wasPlaying = playing;
        setPlaying(false);
        refreshData();
        syncTime(true);
        return () => {
            if (deferredCatalogObject) {
                const body = deferredCatalogObject;
                deferredCatalogObject = null;
                focusCatalog(body);
            }
            setPlaying(wasPlaying);
            lastFrame = performance.now();
        };
    });
    q("#start-tour").addEventListener("click", () => void tour?.start());
} else q<HTMLButtonElement>("#start-tour").disabled = true;
raf = requestAnimationFrame(animate);
if (import.meta.hot)
    import.meta.hot.dispose(() => {
        cancelAnimationFrame(raf);
        clearTimeout(toastTimer);
        tour?.dispose();
        scene?.dispose();
    });
