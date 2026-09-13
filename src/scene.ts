import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
    keplerPosition,
    keplerOrbitPositions,
    type KeplerElements,
} from "./kepler";
import type { CatalogObject } from "./catalog-types";
import {
    MINOR_MOONS,
    targetOffset,
    targetOrbitPoints,
    targetPosition,
    relativePosition,
    isMinorMoon,
    type OrbitTarget,
} from "./minor-moons";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RotationAxis, Vector } from "astronomy-engine";
import {
    ASTRO_BODY,
    childrenOf,
    extra,
    isSatellite,
    parentOf,
    shapeRatios,
    textureOf,
    solarPosition,
    BODIES,
    BODY_IDS,
    DAY,
    ORBIT_IDS,
    PERIODS,
    RADII,
    SATURN_RINGS,
    EXTRA_RINGS,
    eqjToScene,
    orbitSamples,
    positions,
    radius,
    polarRatio,
    type BodyId,
    type Ephemeris,
    type ScaleMode,
} from "./model";

const asset = (name: string) => `${import.meta.env.BASE_URL}textures/${name}`;
const sunVertex = `varying vec3 vP; varying vec3 vN; varying vec3 vW;
  void main(){vP=position; vN=normalize(mat3(modelMatrix)*normal); vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const sunFragment = `varying vec3 vP; varying vec3 vN; varying vec3 vW; uniform float uTime;
  float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
  void main(){float n=noise(vP*25.+uTime*.05)*.6+noise(vP*60.)*.3+noise(vP*140.)*.1;
  float limb=pow(max(dot(normalize(vN),normalize(cameraPosition-vW)),0.),.32);
  vec3 c=mix(vec3(.9,.19,.018),vec3(1.,.82,.32),n)*(.6+.6*limb);gl_FragColor=vec4(c,1.);
  #include <colorspace_fragment>
  }`;
const earthFragment = `uniform sampler2D uDay; uniform sampler2D uNight; uniform vec3 uSun;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
  void main(){float light=dot(normalize(vNormal),normalize(uSun-vWorld));
  vec3 day=texture2D(uDay,vUv).rgb; vec3 night=texture2D(uNight,vUv).rgb;
  float lit=smoothstep(-.13,.24,light); vec3 c=day*(.018+max(light,0.)*1.2)+night*(1.-lit)*1.35;
  float rim=pow(1.-max(dot(normalize(vNormal),normalize(cameraPosition-vWorld)),0.),3.);
  c+=vec3(.045,.18,.32)*rim*lit;gl_FragColor=vec4(c,1.);
  #include <colorspace_fragment>
  }`;
const planetVertex = `varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
  void main(){vUv=uv;vNormal=normalize((vec4(normalMatrix*normal,0.)*viewMatrix).xyz);vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const planetFragment = `uniform sampler2D uMap; uniform vec3 uSunDirection; uniform vec3 uColor; uniform bool uHasMap;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
  void main(){float light=max(dot(normalize(vNormal),uSunDirection),0.);
    vec3 c=(uHasMap?texture2D(uMap,vUv).rgb:uColor)*(.022+light*1.25);
    gl_FragColor=vec4(c,1.);
    #include <colorspace_fragment>
  }`;
const moonFragment = `uniform sampler2D uMap; uniform sampler2D uNormals; uniform mat3 uSurfaceToWorld;
  uniform vec3 uSunDirection;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
  void main(){
    vec3 terrainNormal=normalize(uSurfaceToWorld*(texture2D(uNormals,vUv).rgb*2.-1.));
    float light=dot(normalize(vNormal),uSunDirection)>0.?max(dot(terrainNormal,uSunDirection),0.):0.;
    vec3 c=texture2D(uMap,vUv).rgb*(.022+light*1.25);
    gl_FragColor=vec4(c,1.);
    #include <colorspace_fragment>
  }`;
const ringFragment = `uniform sampler2D uMap; uniform vec3 uSunDirection; uniform vec3 uCenter; uniform float uRadius;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
  void main(){vec4 ring=texture2D(uMap,vUv);if(ring.a<.015)discard;
    vec3 relative=vWorld-uCenter;float along=-dot(relative,uSunDirection);
    float closest=length(relative+max(along,0.)*uSunDirection);
    float shadow=along>0.?smoothstep(uRadius*.98,uRadius*1.02,closest):1.;
    float light=.3+.85*abs(dot(normalize(vNormal),uSunDirection));
    gl_FragColor=vec4(ring.rgb*light*mix(.08,1.,shadow),ring.a*.9);
    #include <colorspace_fragment>
  }`;

export class SolarScene {
    readonly renderer: THREE.WebGLRenderer;
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(38, 1, 0.02, 300_000_000);
    readonly controls: OrbitControls;
    readonly bodies = {} as Record<BodyId, THREE.Group>;
    private readonly surfaces = {} as Record<BodyId, THREE.Mesh>;
    private readonly labels = {} as Record<BodyId, HTMLButtonElement>;
    private readonly raycaster = new THREE.Raycaster();
    private readonly orbits = {} as Record<
        (typeof ORBIT_IDS)[number],
        THREE.Line
    >;
    private readonly planetMaterials = {} as Partial<
        Record<BodyId, THREE.ShaderMaterial>
    >;
    private readonly ring: THREE.Mesh;
    private readonly additionalRings = new Map<BodyId, THREE.Group>();
    private readonly minorMoonCloud: THREE.Points;
    private ringScaleMode: ScaleMode | null = null;
    private readonly loadModels: Partial<Record<BodyId, () => void>> = {};
    private readonly axis = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -1.7, 0),
            new THREE.Vector3(0, 1.7, 0),
        ]),
        new THREE.LineDashedMaterial({
            color: 0xa6dfd3,
            dashSize: 0.1,
            gapSize: 0.08,
            transparent: true,
            opacity: 0.65,
        }),
    );
    private readonly light = new THREE.DirectionalLight(0xfff6eb, 3.4);
    private readonly sunMaterial: THREE.ShaderMaterial;
    private readonly earthMaterial: THREE.ShaderMaterial;
    private readonly stars: THREE.Points;
    private data!: Ephemeris;
    private date!: Date;
    private mode: ScaleMode = "illustrated";
    private selected: BodyId = "earth";
    private overview = false;
    private family = false;
    private showOrbits = true;
    private showMoons = true;
    private smallBodies: KeplerElements[] = [];
    private tracked: OrbitTarget | null = null;
    private trackedOrbit = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
            color: 0xe6c28b,
            transparent: true,
            opacity: 0.7,
        }),
    );
    private trackedMarker = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
        new THREE.ShaderMaterial({
            vertexShader:
                "void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize=10.; }",
            fragmentShader:
                "void main(){ if(length(gl_PointCoord-.5)>.5) discard; gl_FragColor=vec4(1.,.8,.45,1.); }",
            depthTest: false,
        }),
    );
    private trackedLabel: HTMLButtonElement;
    private cloud = new THREE.Points(
        new THREE.BufferGeometry(),
        new THREE.PointsMaterial({
            color: 0xb7bdcc,
            size: 2,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
        }),
    );
    private lastOrbitTime = {} as Partial<
        Record<(typeof ORBIT_IDS)[number], number>
    >;
    private labelVisibility = true;
    private axisVisibility = false;
    private transition: {
        start: THREE.Vector3;
        end: THREE.Vector3;
        t: number;
    } | null = null;
    private origin = new THREE.Vector3();
    private corona: THREE.Sprite;
    private clouds: THREE.Mesh;
    private atmosphere: THREE.Mesh;
    private observer: ResizeObserver;
    private pointerStart = { x: 0, y: 0 };
    private destroyed = false;
    private touring = false;
    private normalCloud: KeplerElements[] = [];
    private onClick: (id: BodyId) => void;
    private onMinorSelect: (id: string) => void;

    constructor(
        private host: HTMLElement,
        onSelect: (id: BodyId) => void,
        onTextureError: (file: string) => void,
        onMinorSelect: (id: string) => void = () => undefined,
    ) {
        this.onClick = onSelect;
        this.onMinorSelect = onMinorSelect;
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
        this.renderer.setClearColor(0x060a10, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.domElement.setAttribute(
            "aria-label",
            "太阳系三维场景，左键拖动旋转，右键拖动平移，滚轮缩放，点击天体选择",
        );
        this.renderer.domElement.setAttribute("tabindex", "0");
        host.append(this.renderer.domElement);
        this.trackedOrbit.visible = this.trackedMarker.visible = false;
        this.trackedMarker.renderOrder = 5;
        this.scene.add(this.trackedOrbit, this.trackedMarker);
        this.trackedLabel = document.createElement("button");
        this.trackedLabel.className = "body-label selected";
        this.trackedLabel.hidden = true;
        this.trackedLabel.onclick = () => {
            if (this.tracked) this.focusCatalog(this.tracked);
        };
        host.append(this.trackedLabel);
        this.controls = new OrbitControls(
            this.camera,
            this.renderer.domElement,
        );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.075;
        this.controls.enablePan = true;
        this.controls.screenSpacePanning = true;
        this.controls.rotateSpeed = 0.5;
        this.controls.zoomSpeed = 0.8;
        this.controls.addEventListener("start", () => {
            this.transition = null;
            this.host.dataset.cameraState = "idle";
        });

        const loader = new THREE.TextureLoader();
        const load = (name: string, srgb = true) => {
            const texture = loader.load(asset(name), undefined, undefined, () =>
                onTextureError(name),
            );
            if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(
                8,
                this.renderer.capabilities.getMaxAnisotropy(),
            );
            return texture;
        };
        const geometry = new THREE.SphereGeometry(1, 96, 64);
        const white = new THREE.DataTexture(
            new Uint8Array([255, 255, 255, 255]),
            1,
            1,
        );
        white.needsUpdate = true;
        const modelLoader = new GLTFLoader();
        this.sunMaterial = new THREE.ShaderMaterial({
            vertexShader: sunVertex,
            fragmentShader: sunFragment,
            uniforms: { uTime: { value: 0 } },
        });
        this.earthMaterial = new THREE.ShaderMaterial({
            vertexShader: planetVertex,
            fragmentShader: earthFragment,
            uniforms: {
                uDay: { value: load("earth.jpg") },
                uNight: { value: load("earth-night.png") },
                uSun: { value: new THREE.Vector3() },
            },
        });
        const materials: Partial<Record<BodyId, THREE.Material>> = {
            sun: this.sunMaterial,
            earth: this.earthMaterial,
        };
        for (const id of BODY_IDS) {
            if (!materials[id]) {
                const material = new THREE.ShaderMaterial({
                    vertexShader: planetVertex,
                    fragmentShader: id === "moon" ? moonFragment : planetFragment,
                    uniforms: {
                        uMap: {
                            value: textureOf(id) ? load(textureOf(id)!) : white,
                        },
                        uHasMap: { value: Boolean(textureOf(id)) },
                        uColor: { value: new THREE.Color(BODIES[id].color) },
                        uSunDirection: { value: new THREE.Vector3() },
                        ...(id === "moon" ? {
                            uNormals: {value: load("moon-lola-normals-2k.png",false)},
                            uSurfaceToWorld: {value:new THREE.Matrix3()},
                        } : {}),
                    },
                });
                materials[id] = material;
                this.planetMaterials[id] = material;
            }
            const body = new THREE.Group();
            const mesh = new THREE.Mesh(geometry, materials[id]);
            mesh.userData.bodyId = id;
            body.add(mesh);
            this.bodies[id] = body;
            this.surfaces[id] = mesh;
            const modelPath = extra(id)?.model;
            if (modelPath)
                this.loadModels[id] = () => {
                    delete this.loadModels[id];
                    modelLoader.load(
                        `${import.meta.env.BASE_URL}${modelPath}`,
                        (gltf) => {
                            if (this.destroyed) return;
                            const box = new THREE.Box3().setFromObject(
                                gltf.scene,
                            );
                            const size = box.getSize(new THREE.Vector3());
                            const center = box.getCenter(new THREE.Vector3());
                            const normalized = new THREE.Group();
                            normalized.scale.set(
                                2 / size.x,
                                2 / size.y,
                                2 / size.z,
                            );
                            gltf.scene.position.sub(center);
                            gltf.scene.traverse((object) => {
                                if (!(object instanceof THREE.Mesh)) return;
                                if (!object.geometry.hasAttribute("normal"))
                                    object.geometry.computeVertexNormals();
                                object.userData.bodyId = id;
                                const original = Array.isArray(object.material)
                                    ? object.material[0]
                                    : object.material;
                                object.material = new THREE.ShaderMaterial({
                                    vertexShader: planetVertex,
                                    fragmentShader: planetFragment,
                                    uniforms: {
                                        uMap: { value: original.map ?? white },
                                        uHasMap: {
                                            value: Boolean(original.map),
                                        },
                                        uColor: {
                                            value:
                                                id === "vesta"
                                                    ? new THREE.Color("#99978f")
                                                    : (original.color ??
                                                      new THREE.Color(
                                                          BODIES[id].color,
                                                      )),
                                        },
                                        uSunDirection:
                                            this.planetMaterials[id]!.uniforms
                                                .uSunDirection,
                                    },
                                });
                                original.dispose();
                            });
                            normalized.add(gltf.scene);
                            mesh.material.visible = false;
                            mesh.add(normalized);
                        },
                        undefined,
                        () => onTextureError(modelPath),
                    );
                };
            this.scene.add(body);
            const label = document.createElement("button");
            label.className = `body-label ${id}`;
            label.style.setProperty("--label-color", BODIES[id].color);
            label.innerHTML = `<span class="label-dot"></span>${BODIES[id].name}<small>${BODIES[id].english}</small>`;
            label.setAttribute("aria-label", `在场景中选择${BODIES[id].name}`);
            label.addEventListener("click", () => onSelect(id));
            host.append(label);
            this.labels[id] = label;
        }
        const inner = SATURN_RINGS.innerKm / RADII.saturn;
        const outer = SATURN_RINGS.outerKm / RADII.saturn;
        const ringGeometry = new THREE.RingGeometry(inner, outer, 192, 1);
        const vertices = ringGeometry.getAttribute("position");
        const uv = ringGeometry.getAttribute("uv");
        for (let i = 0; i < vertices.count; i++) {
            uv.setXY(
                i,
                (Math.hypot(vertices.getX(i), vertices.getY(i)) - inner) /
                    (outer - inner),
                0.5,
            );
        }
        ringGeometry.rotateX(-Math.PI / 2);
        this.ring = new THREE.Mesh(
            ringGeometry,
            new THREE.ShaderMaterial({
                vertexShader: planetVertex,
                fragmentShader: ringFragment,
                uniforms: {
                    uMap: { value: load("saturn-rings.png") },
                    uSunDirection:
                        this.planetMaterials.saturn!.uniforms.uSunDirection,
                    uCenter: { value: new THREE.Vector3() },
                    uRadius: { value: 1 },
                },
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
            }),
        );
        this.ring.userData.bodyId = "saturn";
        this.surfaces.saturn.add(this.ring);
        for (const id of Object.keys(EXTRA_RINGS) as Array<
            keyof typeof EXTRA_RINGS
        >) {
            const group = new THREE.Group();
            group.userData.bodyId = id;
            this.additionalRings.set(id, group);
            this.bodies[id].add(group);
        }
        this.clouds = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
                map: load("earth-clouds.png"),
                transparent: true,
                opacity: 0.38,
                depthWrite: false,
                roughness: 1,
            }),
        );
        this.clouds.scale.setScalar(1.008);
        this.surfaces.earth.add(this.clouds);
        this.atmosphere = new THREE.Mesh(
            geometry,
            new THREE.ShaderMaterial({
                vertexShader: planetVertex,
                fragmentShader: `varying vec3 vNormal; varying vec3 vWorld; uniform vec3 uSun;
      void main(){float f=pow(1.-abs(dot(normalize(vNormal),normalize(cameraPosition-vWorld))),3.5);
      float day=smoothstep(-.3,.5,dot(normalize(vNormal),normalize(uSun-vWorld)));
      gl_FragColor=vec4(vec3(.2,.52,1.),f*(.07+.6*day));}`,
                uniforms: { uSun: this.earthMaterial.uniforms.uSun },
                side: THREE.BackSide,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            }),
        );
        this.atmosphere.scale.setScalar(1.028);
        this.surfaces.earth.add(this.atmosphere);
        this.surfaces.earth.add(this.axis);
        this.axis.computeLineDistances();

        const glow = document.createElement("canvas");
        glow.width = glow.height = 128;
        const ctx = glow.getContext("2d")!;
        const gradient = ctx.createRadialGradient(64, 64, 15, 64, 64, 64);
        gradient.addColorStop(0, "rgba(255,180,77,.6)");
        gradient.addColorStop(0.3, "rgba(255,156,45,.22)");
        gradient.addColorStop(1, "rgba(255,126,20,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        this.corona = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: new THREE.CanvasTexture(glow),
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            }),
        );
        this.bodies.sun.add(this.corona);
        for (const id of ORBIT_IDS) {
            this.orbits[id] = new THREE.Line(
                new THREE.BufferGeometry(),
                new THREE.LineBasicMaterial({
                    color: BODIES[id].color,
                    transparent: true,
                    opacity: 0.23,
                }),
            );
            this.scene.add(this.orbits[id]);
        }
        this.scene.add(
            this.light,
            this.light.target,
            new THREE.AmbientLight(0x7a8ca5, 0.055),
        );

        let seed = 29437;
        const random = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        const points = [],
            colors = [];
        for (let i = 0; i < 1600; i++) {
            const y = random() * 2 - 1,
                a = random() * Math.PI * 2,
                r = Math.sqrt(1 - y * y);
            points.push(
                r * Math.cos(a) * 100_000_000,
                y * 100_000_000,
                r * Math.sin(a) * 100_000_000,
            );
            const b = 0.16 + random() * 0.65;
            colors.push(b * 0.85, b * 0.91, b);
        }
        const starsGeometry = new THREE.BufferGeometry();
        starsGeometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(points, 3),
        );
        starsGeometry.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(colors, 3),
        );
        this.stars = new THREE.Points(
            starsGeometry,
            new THREE.PointsMaterial({
                size: 1.1,
                sizeAttenuation: false,
                vertexColors: true,
                transparent: true,
                opacity: 0.7,
                depthWrite: false,
            }),
        );
        this.scene.add(this.stars, this.cloud);
        const minorGeometry = new THREE.BufferGeometry();
        minorGeometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
                new Float32Array(MINOR_MOONS.length * 3),
                3,
            ),
        );
        this.minorMoonCloud = new THREE.Points(
            minorGeometry,
            new THREE.PointsMaterial({
                color: 0xbfd8ce,
                size: 2.2,
                sizeAttenuation: false,
                transparent: true,
                opacity: 0.9,
            }),
        );
        this.minorMoonCloud.visible = false;
        this.scene.add(this.minorMoonCloud);
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(host);
        this.resize();
        this.renderer.domElement.addEventListener(
            "pointerdown",
            this.pointerDown,
        );
        this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
        this.raycaster.params.Points.threshold = 7;
    }

    private pointerDown = (e: PointerEvent) => {
        this.pointerStart = { x: e.clientX, y: e.clientY };
    };
    private pointerUp = (e: PointerEvent) => {
        if (
            this.touring ||
            e.button !== 0 ||
            Math.hypot(
                e.clientX - this.pointerStart.x,
                e.clientY - this.pointerStart.y,
            ) > 5
        )
            return;
        const rect = this.host.getBoundingClientRect();
        this.raycaster.setFromCamera(
            new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                (-(e.clientY - rect.top) / rect.height) * 2 + 1,
            ),
            this.camera,
        );
        const hit = this.raycaster.intersectObjects(
            [
                ...Object.entries(this.surfaces)
                    .filter(([id]) => this.bodies[id as BodyId].visible)
                    .map(([, mesh]) => mesh),
                ...(this.ring.visible ? [this.ring] : []),
                ...[...this.additionalRings.values()].filter(
                    (group) => group.visible,
                ),
            ],
            true,
        )[0];
        if (hit) this.onClick(hit.object.userData.bodyId);
        else {
            const pointHit = this.raycaster.intersectObject(
                this.minorMoonCloud,
            )[0];
            if (pointHit && pointHit.index !== undefined) {
                const moon = MINOR_MOONS[pointHit.index];
                if (moon) this.onMinorSelect(moon.id);
            }
        }
    };
    private resize() {
        const { width, height } = this.host.getBoundingClientRect();
        this.camera.aspect = width / Math.max(height, 1);
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    update(data: Ephemeris, date: Date, mode: ScaleMode) {
        const changedMode = this.mode !== mode;
        this.data = data;
        this.date = date;
        this.mode = mode;
        const pos = positions(data, mode);
        this.origin.fromArray(
            this.touring
                ? [0, 0, 0]
                : this.tracked?.orbit
                  ? targetPosition(this.tracked, data, date.getTime(), mode)
                  : this.overview
                    ? [0, 0, 0]
                    : pos[this.selected],
        );
        for (const id of BODY_IDS) {
            this.bodies[id].position.fromArray(pos[id]).sub(this.origin);
            this.surfaces[id].scale
                .fromArray(shapeRatios(id))
                .multiplyScalar(radius(id, mode));
            if (ASTRO_BODY[id]) {
                const axis = RotationAxis(ASTRO_BODY[id]!, date);
                const north = new THREE.Vector3(
                    ...eqjToScene(axis.north),
                ).normalize();
                const ra = THREE.MathUtils.degToRad(axis.ra * 15); // AxisInfo.ra is in sidereal hours.
                const node = new Vector(
                    -Math.sin(ra),
                    Math.cos(ra),
                    0,
                    axis.north.t,
                );
                const meridian = new THREE.Vector3(
                    ...eqjToScene(node),
                ).applyAxisAngle(
                    north,
                    THREE.MathUtils.degToRad(axis.spin % 360),
                );
                const z = new THREE.Vector3()
                    .crossVectors(meridian, north)
                    .normalize();
                this.surfaces[id].quaternion.setFromRotationMatrix(
                    new THREE.Matrix4().makeBasis(meridian, north, z),
                );
            } else if (isSatellite(id)) {
                const orbit = extra(id)!.orbit!;
                const inc = THREE.MathUtils.degToRad(orbit.i),
                    node = THREE.MathUtils.degToRad(orbit.node);
                const north = new THREE.Vector3(
                    Math.sin(inc) * Math.sin(node),
                    Math.cos(inc),
                    Math.sin(inc) * Math.cos(node),
                );
                const towardParent = new THREE.Vector3(...data.relative[id])
                    .normalize()
                    .negate();
                const z = new THREE.Vector3()
                    .crossVectors(towardParent, north)
                    .normalize();
                north.crossVectors(z, towardParent).normalize();
                this.surfaces[id].quaternion.setFromRotationMatrix(
                    new THREE.Matrix4().makeBasis(towardParent, north, z),
                );
            } else {
                this.surfaces[id].rotation.set(
                    0,
                    ((date.getTime() / DAY / (extra(id)?.rotationDays ?? 1)) *
                        Math.PI *
                        2) %
                        (Math.PI * 2),
                    0,
                );
            }
            const material = this.planetMaterials[id];
            if (material) {
                if (id === "moon") material.uniforms.uSurfaceToWorld.value.setFromMatrix4(
                    new THREE.Matrix4().makeRotationFromQuaternion(this.surfaces[id].quaternion),
                );
                // Each planet is lit from its own heliocentric direction.
                const direction =
                    id === "moon"
                        ? this.data.earth
                        : this.data.heliocentric[
                              id as keyof Ephemeris["heliocentric"]
                          ];
                material.uniforms.uSunDirection.value
                    .fromArray(direction)
                    .normalize()
                    .negate();
            }
        }
        const ringMaterial = this.ring.material as THREE.ShaderMaterial;
        ringMaterial.uniforms.uCenter.value.copy(this.bodies.saturn.position);
        ringMaterial.uniforms.uRadius.value = radius("saturn", mode);
        if (this.ringScaleMode !== mode) {
            this.ringScaleMode = mode;
            this.rebuildRings(mode);
        }
        for (const [id, group] of this.additionalRings) {
            group.quaternion.copy(this.surfaces[id].quaternion);
            group.scale.setScalar(radius(id, mode));
            for (const band of group.children) {
                const material = (band as THREE.Mesh)
                    .material as THREE.ShaderMaterial;
                material.uniforms.uCenter.value.copy(this.bodies[id].position);
                material.uniforms.uRadius.value = radius(id, mode);
            }
        }
        this.corona.scale.setScalar(radius("sun", mode) * 5.2);
        this.axis.visible = this.axisVisibility;
        this.earthMaterial.uniforms.uSun.value.copy(this.bodies.sun.position);
        this.light.position.copy(this.bodies.sun.position);
        this.light.target.position.copy(this.bodies.earth.position);
        for (const id of ORBIT_IDS) {
            const orbit = this.orbits[id];
            orbit.position.copy(
                isSatellite(id)
                    ? this.bodies[parentOf(id)!].position
                    : this.origin.clone().negate(),
            );
            if (
                changedMode ||
                Math.abs(
                    date.getTime() - (this.lastOrbitTime[id] ?? -Infinity),
                ) >
                    Math.max(2, PERIODS[id] / 90) * DAY
            ) {
                orbit.geometry.dispose();
                orbit.geometry = new THREE.BufferGeometry().setFromPoints(
                    orbitSamples(id, date, mode).map(
                        (p) => new THREE.Vector3(...p),
                    ),
                );
                this.lastOrbitTime[id] = date.getTime();
            }
        }
        this.updateVisibility();
        this.updateMinorMoons();
        this.updateCloud();
        if (this.tracked?.orbit) {
            this.trackedMarker.position.set(0, 0, 0);
            this.trackedOrbit.position.copy(
                isMinorMoon(this.tracked)
                    ? this.bodies[this.tracked.parentBody].position
                    : this.origin.clone().negate(),
            );
            this.trackedOrbit.visible = this.showOrbits;
            if (changedMode) this.focusCatalog(this.tracked);
        } else if (changedMode && !this.touring)
            this.focus(
                this.overview ? "system" : this.selected,
                false,
                this.family,
            );
    }

    focus(id: BodyId | "system", animate = true, family = false) {
        this.clearControlInertia();
        this.tracked = null;
        this.trackedOrbit.visible = this.trackedMarker.visible = false;
        this.trackedLabel.hidden = true;
        this.family = family;
        const oldOrigin = this.origin.clone();
        this.overview = id === "system";
        if (id !== "system") this.selected = id;
        this.update(this.data, this.date, this.mode);
        this.camera.position.add(oldOrigin.sub(this.origin));
        this.controls.target.set(0, 0, 0);
        const earth = new THREE.Vector3(
            ...(this.selected === "moon" || this.selected === "sun"
                ? this.data.earth
                : this.data.heliocentric[this.selected]),
        ).normalize();
        const side = new THREE.Vector3(-earth.z, 0.3, earth.x).normalize();
        const direction = earth
            .clone()
            .negate()
            .multiplyScalar(0.85)
            .addScaledVector(side, 0.65)
            .add(new THREE.Vector3(0, 0.34, 0))
            .normalize();
        const ringSystem =
            EXTRA_RINGS[this.selected as keyof typeof EXTRA_RINGS];
        const extent =
            radius(this.selected, this.mode) *
            (this.selected === "saturn"
                ? SATURN_RINGS.outerKm / RADII.saturn
                : ringSystem
                  ? Math.max(...ringSystem.bands.map((b) => b.outerKm)) /
                    RADII[this.selected]
                  : 1);
        let distance = extent * 5.4;
        if ((this.selected === "saturn" || ringSystem) && !this.overview) {
            direction
                .addScaledVector(
                    new THREE.Vector3(0, 1, 0).applyQuaternion(
                        this.surfaces[this.selected].quaternion,
                    ),
                    0.8,
                )
                .normalize();
        }
        if (this.family && !this.overview) {
            const extent = Math.max(
                radius(this.selected, this.mode) * 3,
                ...childrenOf(this.selected).map(
                    (id) =>
                        this.bodies[id].position.length() +
                        radius(id, this.mode),
                ),
            );
            distance =
                (extent /
                    Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) *
                1.1;
            direction.set(0.3, 1, 0.7).normalize();
        }
        if (this.overview) {
            const span = Math.max(
                ...Object.values(this.bodies).map((body) =>
                    body.position.length(),
                ),
            );
            distance =
                (span /
                    Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) *
                1.12;
            direction.set(0.12, 1, 0.55).normalize();
        }
        // Narrow screens need enough room for a complete body, not a cropped sphere.
        distance *= Math.max(1, 1 / this.camera.aspect);
        this.controls.minDistance = this.overview
            ? distance * 0.08
            : extent * 1.14;
        this.controls.maxDistance =
            this.mode === "physical" ? 600_000_000 : 100000;
        this.camera.near = Math.max(
            0.001,
            this.overview
                ? distance / 10000
                : radius(this.selected, this.mode) * 0.002,
        );
        this.camera.updateProjectionMatrix();
        const end = direction.multiplyScalar(distance);
        if (
            animate &&
            !matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
            this.transition = {
                start: this.camera.position.clone(),
                end,
                t: 0,
            };
            this.host.dataset.cameraState = "moving";
        } else {
            this.transition = null;
            this.camera.position.copy(end);
            this.host.dataset.cameraState = "idle";
        }
        this.controls.update();
    }
    private updateVisibility() {
        if (this.touring) {
            for (const id of BODY_IDS) this.bodies[id].visible = true;
            for (const id of ORBIT_IDS) this.orbits[id].visible = false;
            this.minorMoonCloud.visible = false;
            return;
        }
        const anchor = isSatellite(this.selected)
            ? parentOf(this.selected)!
            : this.selected;
        for (const id of BODY_IDS)
            this.bodies[id].visible =
                !isSatellite(id) ||
                id === this.selected ||
                (this.showMoons &&
                    !this.overview &&
                    !this.tracked &&
                    parentOf(id) === anchor);
        for (const id of BODY_IDS)
            if (
                this.bodies[id].visible &&
                (id === this.selected ||
                    (this.family && parentOf(id) === this.selected))
            )
                this.loadModels[id]?.();
        for (const id of ORBIT_IDS)
            this.orbits[id].visible =
                this.showOrbits &&
                !this.tracked &&
                (this.overview
                    ? !isSatellite(id)
                    : isSatellite(id)
                      ? this.showMoons && parentOf(id) === anchor
                      : id === anchor);
        this.minorMoonCloud.visible =
            this.showMoons &&
            (this.overview || this.family || isMinorMoon(this.tracked));
    }
    setSmallBodies(bodies: KeplerElements[]) {
        if (this.touring) {
            this.normalCloud = bodies;
            return;
        }
        this.applyCloud(bodies);
    }
    private applyCloud(bodies: KeplerElements[]) {
        this.smallBodies = bodies;
        this.cloud.geometry.dispose();
        this.cloud.geometry = new THREE.BufferGeometry();
        this.cloud.geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
                new Float32Array(bodies.length * 3),
                3,
            ),
        );
        this.cloud.visible = bodies.length > 0;
        this.updateCloud();
    }
    beginTour() {
        this.clearControlInertia();
        const state = {
            mode: this.mode,
            selected: this.selected,
            overview: this.overview,
            family: this.family,
            tracked: this.tracked,
            data: this.data,
            date: this.date,
            orbits: this.showOrbits,
            labels: this.labelVisibility,
            axis: this.axisVisibility,
            moons: this.showMoons,
            rings: this.ring.visible,
            camera: this.camera.position.clone(),
            target: this.controls.target.clone(),
            near: this.camera.near,
            far: this.camera.far,
            min: this.controls.minDistance,
            max: this.controls.maxDistance,
            enabled: this.controls.enabled,
        };
        this.normalCloud = this.smallBodies;
        this.touring = true;
        this.tracked = null;
        this.transition = null;
        this.trackedOrbit.visible = this.trackedMarker.visible = false;
        this.trackedLabel.hidden = true;
        this.labelVisibility = this.axisVisibility = false;
        this.ring.visible = true;
        for (const group of this.additionalRings.values()) group.visible = true;
        this.controls.enabled = false;
        this.controls.minDistance = 0.2;
        this.controls.maxDistance = 200000;
        this.camera.near = 0.02;
        this.camera.far = 300_000_000; // The background stars lie 100 million scene units away.
        this.resize();
        this.applyCloud([]);
        this.update(state.data, state.date, "illustrated");
        this.host.dataset.cameraState = "tour";
        let restored = false;
        return {
            data: state.data,
            date: state.date,
            restore: () => {
                if (restored) return;
                restored = true;
                this.clearControlInertia();
                this.touring = false;
                // The restored mode must rebuild orbit geometry even at the same epoch.
                if (this.mode !== state.mode) this.lastOrbitTime = {};
                this.mode = state.mode;
                this.selected = state.selected;
                this.overview = state.overview;
                this.family = state.family;
                this.tracked = state.tracked;
                this.setLayers(
                    state.orbits,
                    state.labels,
                    state.axis,
                    state.rings,
                    state.moons,
                );
                this.update(state.data, state.date, state.mode);
                if (state.tracked) this.focusCatalog(state.tracked);
                this.applyCloud(this.normalCloud);
                this.camera.position.copy(state.camera);
                this.controls.target.copy(state.target);
                this.camera.near = state.near;
                this.camera.far = state.far;
                this.controls.minDistance = state.min;
                this.controls.maxDistance = state.max;
                this.controls.enabled = state.enabled;
                this.resize();
                this.controls.update();
                this.host.dataset.cameraState = "idle";
            },
        };
    }
    setTourFrame(camera: THREE.Vector3, target: THREE.Vector3) {
        if (!this.touring) return;
        this.camera.position.copy(camera);
        this.controls.target.copy(target);
        this.camera.lookAt(target);
        this.controls.update();
    }
    setTourPaused(paused: boolean) {
        this.clearControlInertia();
        this.controls.enabled = paused;
    }
    setTourCloud(bodies: KeplerElements[]) {
        if (this.touring) this.applyCloud(bodies);
    }
    prepareTourBody(id: BodyId, family = false) {
        this.loadModels[id]?.();
        if (family)
            for (const child of childrenOf(id)) this.loadModels[child]?.();
    }
    private rebuildRings(mode: ScaleMode) {
        for (const [id, group] of this.additionalRings) {
            for (const item of [...group.children]) {
                const mesh = item as THREE.Mesh<
                    THREE.BufferGeometry,
                    THREE.ShaderMaterial
                >;
                mesh.geometry.dispose();
                mesh.material.uniforms.uMap.value.dispose();
                mesh.material.dispose();
                group.remove(item);
            }
            for (const band of EXTRA_RINGS[id as keyof typeof EXTRA_RINGS]
                .bands) {
                const center = (band.innerKm + band.outerKm) / 2;
                // Width unknown (Arago) is a locator line; no invented physical width.
                const width = Math.max(
                    band.widthKm ?? 0,
                    mode === "illustrated" ? RADII[id] * 0.012 : 0,
                );
                if (!width) continue;
                const geometry = new THREE.RingGeometry(
                    (center - width / 2) / RADII[id],
                    (center + width / 2) / RADII[id],
                    256,
                );
                geometry.rotateX(-Math.PI / 2);
                const color = new THREE.Color(band.color);
                const texture = new THREE.DataTexture(
                    new Uint8Array([
                        color.r * 255,
                        color.g * 255,
                        color.b * 255,
                        band.opacityIllustrated * 255,
                    ]),
                    1,
                    1,
                );
                texture.needsUpdate = true;
                const material = new THREE.ShaderMaterial({
                    vertexShader: planetVertex,
                    fragmentShader: ringFragment,
                    uniforms: {
                        uMap: { value: texture },
                        uSunDirection:
                            this.planetMaterials[id]!.uniforms.uSunDirection,
                        uCenter: { value: new THREE.Vector3() },
                        uRadius: { value: 1 },
                    },
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData.bodyId = id;
                group.add(mesh);
            }
        }
    }
    focusCatalog(body: OrbitTarget) {
        if (!body.orbit) return;
        this.clearControlInertia();
        this.tracked = body;
        this.overview = false;
        this.family = false;
        this.transition = null;
        this.host.dataset.cameraState = "idle";
        this.update(this.data, this.date, this.mode);
        this.trackedOrbit.geometry.dispose();
        const points = isMinorMoon(body)
            ? targetOrbitPoints(body, this.mode)
            : keplerOrbitPositions(body.orbit).map((point) =>
                  solarPosition(point, this.mode),
              );
        this.trackedOrbit.geometry = new THREE.BufferGeometry().setFromPoints(
            points.map((point) => new THREE.Vector3(...point)),
        );
        this.trackedMarker.visible = true;
        this.trackedLabel.textContent = body.name;
        const span = new THREE.Box3()
            .setFromBufferAttribute(
                this.trackedOrbit.geometry.getAttribute(
                    "position",
                ) as THREE.BufferAttribute,
            )
            .getSize(new THREE.Vector3())
            .length();
        const distance =
            Math.max(
                isMinorMoon(body)
                    ? this.mode === "physical"
                        ? 8
                        : 6
                    : this.mode === "physical"
                      ? 2000
                      : 30,
                (span /
                    Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) *
                    1.05,
            ) * Math.max(1, 1 / this.camera.aspect);
        this.camera.position
            .set(0.2, 1, 0.6)
            .normalize()
            .multiplyScalar(distance);
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = distance * 0.001;
        this.controls.maxDistance = Math.max(distance * 20, 100000);
        this.camera.near = Math.max(0.001, distance / 100000);
        this.camera.far = Math.max(300000000, distance * 100);
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }
    private updateCloud() {
        if (!this.data || !this.smallBodies.length) return;
        const buffer = this.cloud.geometry.getAttribute("position");
        for (let i = 0; i < this.smallBodies.length; i++) {
            const point = new THREE.Vector3(
                ...solarPosition(
                    keplerPosition(this.smallBodies[i], this.date.getTime()),
                    this.mode,
                ),
            ).sub(this.origin);
            buffer.setXYZ(i, point.x, point.y, point.z);
        }
        buffer.needsUpdate = true;
        this.cloud.geometry.computeBoundingSphere();
    }
    private updateMinorMoons() {
        const buffer = this.minorMoonCloud.geometry.getAttribute(
            "position",
        ) as THREE.BufferAttribute;
        for (let i = 0; i < MINOR_MOONS.length; i++) {
            const item = MINOR_MOONS[i];
            const parent = this.bodies[item.parentBody as BodyId];
            const rel = relativePosition(item, this.date.getTime());
            const offset = targetOffset(item, rel, this.mode);
            buffer.setXYZ(
                i,
                parent.position.x + offset[0],
                parent.position.y + offset[1],
                parent.position.z + offset[2],
            );
        }
        buffer.needsUpdate = true;
        this.minorMoonCloud.geometry.computeBoundingSphere();
    }
    setLayers(
        orbits: boolean,
        labels: boolean,
        axis: boolean,
        rings = true,
        moons = true,
    ) {
        this.showOrbits = orbits;
        this.showMoons = moons;
        this.trackedOrbit.visible = Boolean(this.tracked) && orbits;
        this.updateVisibility();
        this.ring.visible = rings;
        for (const group of this.additionalRings.values())
            group.visible = rings;
        this.labelVisibility = labels;
        this.axisVisibility = axis;
        this.axis.visible = axis;
    }
    zoom(factor: number) {
        this.transition = null;
        this.host.dataset.cameraState = "idle";
        this.camera.position
            .sub(this.controls.target)
            .multiplyScalar(factor)
            .add(this.controls.target);
        this.controls.update();
    }
    private clearControlInertia() {
        const damping = this.controls.enableDamping;
        this.controls.enableDamping = false;
        this.controls.update();
        this.controls.enableDamping = damping;
    }
    reset() {
        if (this.tracked) {
            this.focusCatalog(this.tracked);
            return;
        }
        this.focus(this.overview ? "system" : this.selected, true, this.family);
    }

    render(dt: number, time: number) {
        if (this.destroyed) return;
        if (this.transition) {
            this.transition.t = Math.min(1, this.transition.t + dt / 0.95);
            const t = this.transition.t,
                eased = t * t * (3 - 2 * t);
            this.camera.position.lerpVectors(
                this.transition.start,
                this.transition.end,
                eased,
            );
            if (t === 1) {
                this.transition = null;
                this.host.dataset.cameraState = "idle";
            }
        }
        this.controls.update();
        this.stars.position.copy(this.camera.position);
        this.sunMaterial.uniforms.uTime.value = time;
        this.renderer.render(this.scene, this.camera);
        if (this.tracked) {
            const point = new THREE.Vector3().project(this.camera);
            this.trackedLabel.hidden =
                !this.labelVisibility || point.z < -1 || point.z > 1;
            this.trackedLabel.style.transform = `translate(${(point.x * 0.5 + 0.5) * this.host.clientWidth + 12}px, ${(-point.y * 0.5 + 0.5) * this.host.clientHeight + 12}px)`;
        }
        const w = this.host.clientWidth,
            h = this.host.clientHeight;
        const occupied: { x: number; y: number }[] = [];
        const labelOrder = [
            this.selected,
            ...BODY_IDS.filter((id) => id !== this.selected),
        ];
        for (const id of labelOrder) {
            const world = this.bodies[id].position;
            const distance = this.camera.position.distanceTo(world);
            const p = world.clone().project(this.camera);
            const pixels =
                ((radius(id, this.mode) / distance) * h) /
                (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
            const x = (p.x * 0.5 + 0.5) * w,
                y = (-p.y * 0.5 + 0.5) * h;
            const lx = x + Math.min(pixels * 0.76, 130);
            const ly = y + Math.min(pixels * 0.65, 180) + 14;
            const visible =
                this.labelVisibility &&
                this.bodies[id].visible &&
                p.z < 1 &&
                p.z > -1 &&
                x > 12 &&
                x < w - 90 &&
                y > 0 &&
                y + pixels < h - 36 &&
                !occupied.some(
                    (other) =>
                        Math.abs(other.x - lx) < 110 &&
                        Math.abs(other.y - ly) < 30,
                );
            if (visible) occupied.push({ x: lx, y: ly });
            this.labels[id].hidden = !visible;
            this.labels[id].style.transform =
                `translate(${x + Math.min(pixels * 0.76, 130)}px, ${y + Math.min(pixels * 0.65, 180) + 14}px)`;
            this.labels[id].classList.toggle(
                "selected",
                id === this.selected && !this.overview,
            );
        }
    }
    dispose() {
        this.destroyed = true;
        this.observer.disconnect();
        this.controls.dispose();
        this.renderer.domElement.removeEventListener(
            "pointerdown",
            this.pointerDown,
        );
        this.renderer.domElement.removeEventListener(
            "pointerup",
            this.pointerUp,
        );
        const textures = new Set<THREE.Texture>();
        this.scene.traverse((obj) => {
            if (
                obj instanceof THREE.Mesh ||
                obj instanceof THREE.Points ||
                obj instanceof THREE.Line ||
                obj instanceof THREE.Sprite
            ) {
                if ("geometry" in obj) obj.geometry.dispose();
                const materials = Array.isArray(obj.material)
                    ? obj.material
                    : [obj.material];
                for (const m of materials) {
                    for (const value of Object.values(m))
                        if (value instanceof THREE.Texture) textures.add(value);
                    if (m instanceof THREE.ShaderMaterial)
                        for (const u of Object.values(m.uniforms))
                            if (u.value instanceof THREE.Texture)
                                textures.add(u.value);
                    m.dispose();
                }
            }
        });
        textures.forEach((texture) => texture.dispose());
        this.renderer.dispose();
        this.host.replaceChildren();
    }
}
