# 数据与资源来源

## 当前版本实际使用

当前 46 个有模型/资料的主要天体、395 个可选择的小卫星轨道点，以及 16 类小天体目录采用混合来源：新增行星、卫星、矮行星的资源来自 OpenSpace 的资产引用，位置使用 Astronomy Engine 或从 OpenSpace 提取的开普勒要素。部分卫星在导入时读取了原 SPICE 内核的局部记录；浏览器没有运行完整 SPICE。Three.js 负责三维渲染。2026-09-11 另从 NASA/JPL/PDS 直接补充物理与环参数；新增来源与原 OpenSpace 清单分开记录。

| 天体 | OpenSpace 资源标识 / 版本 | 原始文件 | 浏览器文件 |
| --- | --- | --- | --- |
| 水星 | `mercury_textures` / 2 | `Mercury_MESSENGER_MDIS_Basemap_BDR_Mosaic_Global_32ppd.jpg` | `mercury.jpg` |
| 金星 | `venus_textures` / 2 | `venus_clouds.jpg`（可见云层） | `venus.jpg` |
| 火星 | `mars_textures` / 3 | `mars.png` | `mars.jpg` |
| 木星 | `jupiter_textures` / 2 | `jupiter_os.tif` | `jupiter.jpg` |
| 土星 | `saturn_textures` / 4 | `saturn.jpg`（资源列表指向文件版本 1） | `saturn.jpg` |
| 天王星 | `uranus_textures` / 1 | `uranus.jpg` | `uranus.jpg` |
| 海王星 | `neptune_textures` / 1 | `neptune.jpg` | `neptune.jpg` |
| 土星环 | `saturn_textures` / 4 | `color_original_single.png`、`trans_original_single.png` | `saturn-rings.png` |

行星定义位于 `../data/assets/scene/solarsystem/planets/<planet>/globe.asset`，纹理定义位于各行星的 `layers/colorlayers/<planet>_texture.asset`。新增行星赤道/极半径从原资产提取并由米换算为千米。土星环内半径 74,500 km、外半径 140,445 km 来自 `saturn/globe.asset` 的 Offset / Size 字段。

资源查询使用 `openspace.cfg` 中的 `https://liu-se.bigbang.openspaceproject.com/request`；保留其返回的具体文件路径，下载时使用 HTTPS。图片转换为最长 2048×1024 的 JPEG（quality=90），不翻转或重绘地貌。土星环把一维颜色与 `1 - transparency.r` 合成为带透明度的 PNG，这与 OpenSpace `advanced_rings_fs.glsl` 的透明度定义一致。未移植完整散射模型；金星云层按本体旋转，未模拟大气超旋转。纹理经线配准和色彩没有导航级或测光级校准。

可审计清单位于 [`src/openspace-data.json`](src/openspace-data.json)，包含原资产路径、资源标识、版本、实际下载 URL、原图尺寸和转换前后 SHA-256。导入脚本不执行 Lua，只匹配此快照中已知的字面量字段：

```sh
python3 -m venv /tmp/solarspace-assets-venv
/tmp/solarspace-assets-venv/bin/pip install Pillow
/tmp/solarspace-assets-venv/bin/python scripts/import-openspace.py --cache /tmp/solarspace-openspace-assets
```

导入需要本机有 `curl`，并保留上级 OpenSpace 源码中的 `data/assets`；仅部署 Web 目录的服务器无需运行导入脚本。原始大图保存在指定缓存目录，转换后的图片随 `dist/` 部署，浏览器运行时不访问 OpenSpace 服务器。资源下载日期：2026-09-10。资产定义的作者/许可字段来自 OpenSpace Team；该字段不等同于所有上游观测图像的独立授权声明，保留原始来源与路径以便追溯。

| 内容                                     | 来源                                                                                                             | 使用方式                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 八大行星日心位置、月球地心位置、月相、自转轴 | [Astronomy Engine](https://github.com/cosinekitty/astronomy)，npm `astronomy-engine@2.1.19`，作者 Don Cross，MIT | 浏览器内计算；不是 OpenSpace SPICE 计算结果                     |
| 3D 渲染                                  | [Three.js](https://threejs.org/)，npm `three@0.186.0`，MIT                                                       | 浏览器 WebGL2                                                   |
| 地球日间纹理                             | [earth_atmos_2048.jpg](https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg)                       | 保存为 `public/textures/earth.jpg`                              |
| 地球夜间灯光                             | [earth_lights_2048.png](https://threejs.org/examples/textures/planets/earth_lights_2048.png)                     | 保存为 `public/textures/earth-night.png`                        |
| 云层                                     | [earth_clouds_1024.png](https://threejs.org/examples/textures/planets/earth_clouds_1024.png)                     | 保存为 `public/textures/earth-clouds.png`                       |
| 月球纹理                                 | [moon_1024.jpg](https://threejs.org/examples/textures/planets/moon_1024.jpg)                                     | 保存为 `public/textures/moon.jpg`                               |
| 日地月半径、各天体质量、周期、温度等概览参数 | [NASA 行星事实表](https://nssdc.gsfc.nasa.gov/planetary/factsheet/)及 IAU 常用参考值 | 人工整理到 `src/model.ts`，只作科普概览；新增七颗行星的半径来自上述 OpenSpace 清单 |
| 太阳表面                                 | 原型内程序化着色器                                                                                               | 视觉示意，不是观测图像                                          |

纹理下载日期：2026-09-10。上述图片按来源原样保留，未宣称为本项目原创；Three.js 代码的 MIT 许可与每张纹理的原始素材权利应分别对待。公开发行前应追溯原始图片来源并按其署名/授权要求使用，或替换为具备明确使用许可的 NASA 素材。

## 新增卫星、矮行星与其他小天体

2026-09-10 本次新增 36 个可选天体（26 颗卫星、五颗矮行星、五个其他小天体）。配合原太阳、八大行星和月球，场景共有 46 个有模型/资料的天体；另有 395 个小卫星点可选择跟踪。完整尺寸、轨道、原资产路径和校验清单位于 [`src/extended-data.json`](src/extended-data.json)。

以下 15 张影像均由对应 OpenSpace 资源列表下载，转为不超过 2048×1024 的 JPEG（quality=88）。不以重绘或 AI 生成补全地貌；原始拼接图的缺测、填补、投影和颜色限制继续保留。

| 天体 | 资源标识 / 版本 | 原始文件 |
| --- | --- | --- |
| 木卫一 | `io_textures` / 1 | `io.jpg` |
| 木卫二 | `europa_textures` / 2 | `europa_os.tif` |
| 木卫三 | `ganymede_textures` / 1 | `ganymede.jpg` |
| 木卫四 | `callisto_textures` / 2 | `callisto_os.tif` |
| 土卫一 | `mimas_textures` / 1 | `mimas.jpg` |
| 土卫二 | `enceladus_textures` / 1 | `enceladus.jpg` |
| 土卫三 | `tethys_textures` / 1 | `tethys.jpg` |
| 土卫四 | `dione_textures` / 1 | `dione.jpg` |
| 土卫五 | `rhea_textures` / 1 | `rhea.jpg` |
| 土卫六 | `titan_textures` / 2 | `Titan_ISS_P19658_Mosaic_Global_4km_os.tif` |
| 土卫八 | `iapetus_textures` / 1 | `iapetus.jpg` |
| 海卫一 | `triton_textures` / 1 | `Triton_Voyager2_ClrMosaic_GlobalFill_600m.png` |
| 谷神星 | `ceres_textures` / 2 | `ceres_lamo_4096x2048.png` |
| 冥王星 | `pluto_textures` / 5 | `NH_Pluto_mosaic_16384.png` |
| 冥卫一 | `charon_textures` / 3 | `NH_Charon_mosaic.png` |

初次扩展保留五个原始 GLB：`phobos_model`、`deimos_model`、`eris_model`、`haumea_model`、`makemake_model`，均为资源版本 1。文件与校验值见清单 `resources`。渲染时保留原 UV 和模型拓扑，按所采用的三轴尺寸缩放。遥远天体的模型表面为艺术示意，不能当作近距离观测图。

土卫七、天王星五大卫星、海卫二、四颗冥王星小卫星及部分遥远天体尚未接入表面影像，使用纯色形状或平均半径等效球。2026-09-11 已导入灶神星原 OBJ 的简化网格，使用纯色材质。土卫六显示卡西尼 ISS 地表拼接表示，没有叠加完整云雾模型。

### 轨道与时间

| 对象 | 实际采用的位置数据 |
| --- | --- |
| 八大行星、原月球、冥王星 | Astronomy Engine，日心/地心解析模型 |
| 木星四大卫星 | Astronomy Engine `JupiterMoons`，L1 模型；导入的 SPK 状态只留作来源记录 |
| 其他新增卫星 | 下表 OpenSpace SPK 在 2026-09-10 00:00 UTC 的状态，经 CSPICE `oscelt` 转为固定二体要素 |
| 谷神星 | 同项目主带 SBDB 快照中的 `1 Ceres`；旧内核不覆盖本次选定历元 |
| 阋神星、妊神星、鸟神星、灶神星、塞德娜、创神星、共工星、亡神星 | 原 `transforms.asset` 的字面量开普勒要素，原历元分别保留在清单 |
| 小天体点云 | 每条原始 SBDB 记录的轨道要素和历元 |

| 母星系统 | OpenSpace 内核资源 / 版本 | 使用的文件 |
| --- | --- | --- |
| 火星 | `mars_kernels` / 1 | `mar097.bsp` |
| 木星 | `jupiter_kernels` / 3 | `jup365.bsp` |
| 土星 | `saturn_kernels` / 3 | `sat441.bsp` |
| 天王星 | `uranus_kernels` / 3 | `ura111.bsp` |
| 海王星 | `neptune_kernels` / 3 | `nep097.bsp`、`nep101xl-802.bsp` |
| 冥王星 | `pluto_kernels` / 1 | `ssd_jpl_nasa_gov_plu043.bsp` |

`scripts/spk.py` 通过带校验的 HTTP Range 读取 DAF 描述符和所需历元的 type 2/3 切比雪夫记录。**没有下载整套多 GB 内核**，也没有在浏览器按任意日期调用 SPICE。读取过的 URL、范围与校验信息保存在 `extended-data.json` 的 `spk` 项；原记录缓存在 `data-cache/openspace/`。

二体换算的母星 GM 为导入脚本手工给定的近似值（km³/s²）：火星 42828.375214，木星 126686534.911，土星 37931207.8，天王星 5793951.3，海王星 6835099.97，冥王星系统 975.5。这些值并非自动从本次 OpenSpace 资源读取。冥卫一相对冥王星；四颗小卫星的原状态相对冥王星系统质心，运行时用冥卫一相对向量乘 `105.9 / 975.5` 近似求质心偏移。

本次 UTC→ET 转换使用当代 UTC/TAI 偏移、32.184 秒以及 TDB 周期近似；不是完整闰秒核转换。原资产和 SBDB 日期也按页面时间轴近似映射，没有逐条实现 TDB/UTC 的完整换算。浏览器统一映射到 J2000 黄道系，并采用 `(x, z, -y)` 作为 Y 向上场景坐标。

固定二体外推忽略摄动、卫星共振与长期进动；高倍播放和远离历元时只能用于观察轨道形态，不能据此推算精确相位、掩食或导航。新增卫星采用朝向母星的姿态示意，并非观测自转；特别不能把土卫七等天体解释为同步自转。主要行星和原月球保留 Astronomy Engine IAU 旋转模型。

### 尺寸与形状

卫星、谷神星、冥王星、灶神星主要使用 OpenSpace `general_pck` / 1 提供的 `pck00011.tpc` 三轴半径。原 `.asset` 数值同时保存在 `assetRadiiKm`：例如海卫一原资产数值约为直径，现改用半径 1,352.6 km；天卫一参考半径改为 581.1 km；土卫七三轴为 180.1、133、102.7 km；冥王星为 1,188.3 km。

冥卫二、三、四、五的原资产和旧参数核不足以确认可靠形状，原始清单继续保留 `radiusQuality: placeholder` 作为历史记录。2026-09-11 的补充数据覆盖运行时尺寸：采用 JPL 平均半径估计的等效球，标记 `mean-estimate`；详见下方新增来源。没有据平均半径推造三轴形状。

部分遥远天体采用人工整理的观测估计尺寸：阋神星 1,163 km；妊神星三轴 1,161、852、513 km；鸟神星 715 km；塞德娜 497.5 km；创神星 569、569、518 km；亡神星 455、455、458.5 km。此批数值未建立逐项论文版本与不确定度记录，只用于展示；不应把它们归为全部直接取自 OpenSpace 或精密实测半径。共工星沿用原资产半径 615 km。资料面板的参考半径取第一主轴，非体积等效半径。

2026-09-11 已补充 27 颗卫星以及谷神星、灶神星的 JPL 物理参数。仍缺少的质量、温度等资料显示“未收录”。展示比例还对小卫星、小天体设置最小可见半径，并独立压缩卫星距离，图形大小不代表真实物理比例；真实比例使用统一缩放，但占位/估计参数仍受上述来源限制。

## 完整小天体目录

`scripts/sync-catalogs.py` 读取 `data/profiles/addons/asteroids.addon` 中的 16 类资源定义，并下载各 `.asset` 指定的完整 OpenSpace/JPL SBDB CSV。此次合计 **1,545,346 条分类记录**；分类存在交集，不能称为同样数量的独立天体。主带目录有 **1,365,050 条**。

每类原 CSV 完整保存为 `public/catalogs/<id>.csv.gz`，解压后的 SHA-256 与下载原件核对。对应 `.meta.json` 记录原资源版本、URL、原件与压缩包哈希、总行数、支持的椭圆轨道行数、抽样数。`summary.json` 汇总 16 类目录。压缩文件合计约 101 MiB，不在首页自动下载。

浏览器点云每类按天体名称 SHA-256 排序确定性抽取最多 3,000 条，并保留谷神星、智神星、婚神星、灶神星、哈雷彗星等指定记录；因此主带为 3,004 条。不输入关键词时只展示部分样本；完整搜索通过下述全量索引实现。少于上限的类别完整显示有效椭圆轨道。海王星外目录有 1 条非椭圆或不完整轨道，保留在压缩原件中但未绘制；没有为其伪造椭圆。

这是 OpenSpace 所引用版本的目录快照；下载日期不等于观测日期或轨道历元。点云不包含每个对象的实测直径、贴图或彗尾；“潜在危险”是轨道类别标签，不是当前撞击预警。

## 验证与后续边界

原生 CSPICE 对照覆盖 26 个 SPK 段，每段三个时间，读取结果与参考计算的位置差小于 `1e-6 km`、速度差小于 `1e-10 km/s`；另有 24 组 CSPICE `conics` 状态用于浏览器开普勒测试。这些容差验证代码读取/换算一致性，不是模型对真实观测的误差承诺。所有 16 个目录的原件哈希、导入影像/模型哈希均已校验。

仍未接入所有已知卫星、行星环的完整散射与动力学、高清地形和影像瓦片、完整 SPICE 位置与姿态求解。源代码中存在 `.asset` 定义不代表其全部远程数据已经下载。导入与复现步骤见 [README.md](README.md)。

## 2026-09-11 补充：物理资料、行星环与灶神星模型

本批可审计清单为 `src/supplemental-data.json`，由 `scripts/enrich-system.py` 生成，记录来源 URL、下载日期、原件 SHA-256、参数与可用误差。

- **27 颗卫星**：直接读取 [JPL Satellite Physical Parameters](https://ssd.jpl.nasa.gov/sats/phys_par/)，补充 GM、GM 误差与参考星历、平均半径、半径误差和文献、密度与误差。质量按 `M = GM / G` 换算，`G = 6.67430e-20 km³ kg⁻¹ s⁻²`（CODATA 2018，相对标准不确定度约 2.2e-5）；页面质量是科普舍入值，完整 GM 误差保留在清单。
- **谷神星、灶神星**：直接读取 JPL SBDB `phys-par=true`。谷神星资料引用 Nature 537, 515–517 (2016)；灶神星引用 Park et al. (2025), DOI `10.1038/s41550-025-02533-7`。清单保留原 `phys_par` 中每项参数的来源和单位。等效直径除以 2 得到等效半径，展示在来源说明中，不覆盖原 PCK 三轴参考尺寸。
- **冥王星小卫星**：用该 JPL 表的平均半径更新运行时等效球：Nix 18±1、Hydra 18.5±1、Kerberos 6±1、Styx 5.2±1 km；平均半径文献为 Stern et al. (2018), *The Pluto System After New Horizons*。质量参考表中的 PLU060 解；Kerberos 和 Styx 的 GM 为上限，质量也以 `<` 标示。此更新仅改物理资料，轨道继续使用原本的 SPK 历元近似，不能据此声称已升级到 PLU060 星历。
- **三个新增行星环系统**：直接读取 NASA PDS Ring-Moon Systems Node 的 [木星](https://pds-rings.seti.org/jupiter/jupiter_rings_table.html)、[天王星](https://pds-rings.seti.org/uranus/uranus_rings_table.html)、[海王星](https://pds-rings.seti.org/neptune/neptune_rings_table.html)表格。导入木星 5 个环成分、天王星 13 个主要命名环、海王星 5 个主要命名环的尺寸；木星 Halo 的垂直厚度没有重建，天王星附加尘带和海王星环弧也未绘制。
- 环带采用母行星 IAU 赤道面、圆形共面近似。颜色与透明度是人为选定的观察示意，**没有把它们当作原始观测贴图或光学深度**。展示比例下最小环宽为母星参考半径的 1.2%，真实比例下恢复来源宽度；没有宽度的 Arago 环仅在展示比例显示位置线，Le Verrier 使用 `<100 km` 的上界 100 km。未模拟环偏心、进动、环弧经度、粒子结构及精确光度。
- **灶神星模型**：从原项目 `vesta/model.asset` 引用的 `vesta_model` / 1 下载 `VestaComet_5000.obj` 和材质文件。原件约 154 MB、799,999 面；合并重合顶点、归一化后做二次误差简化，再恢复原始单位，生成 80,000 面的约 1.4 MB GLB。原件与输出哈希、面数记录在清单，浏览器仍按 PCK 三轴归一化呈现。没有表面影像，使用纯色材质。

温度、缺测影像等没有可靠来源的字段继续留空或使用明确的纯色示意。此次没有采纳其他遥远天体 SBDB 中可能存在歧义的自转周期，也没有把搜到的资料自动当作完整精确的物理模型。

## 2026-09-11 全量目录索引与跟随

`scripts/index-catalogs.py` 从已校验的全部 16 类 CSV.gz 构建 `data/catalog.sqlite`，按完全相同的 `full_name` 去重后为 **1,542,803 个对象**；原始分类记录仍为 1,545,346 条。保留所有类别成员关系；同名重复记录取最新有效轨道历元，来源类别随所选记录保存。这不是别名或临时编号的身份归并。16 个原始压缩文件不变。

索引含 SQLite FTS5 trigram 名称查询，约 762 MiB，保留在静态站点根目录之外。名称/临时编号为不区分大小写的子串检索，至少 3 个字符；纯数字按正式小行星编号精确匹配。每页 40 条，最多翻至偏移 10,000，超过后需缩小范围。对象链接使用名称 SHA-256 的前 24 个十六进制字符；这些 ID 不依赖数据库插入顺序。

浏览器只请求搜索结果和单对象要素，选择后显示位置标记与独立轨道，并按时间跟随。无实测尺寸/形状的目录对象是恒定屏幕大小的圆点，不展示虚构地貌。原目录中 `(2002 PD153)` 的非椭圆/不完整记录可搜索和下载，但禁止用本模型定位。

API 由现有 Node 服务启动系统 Python 的只读 SQLite 子进程提供，SQLite 连接使用 `mode=ro` 和 `query_only`。查询参数化、有分页和执行时限；不在请求中执行 Shell，不把数据库作为静态文件公开，也不在运行时访问外部星历网站。浏览器的数据精度继续受原 SBDB 历元和固定二体模型限制。

## 2026-09-11 沉浸漫游

32 站自动导览复用上述天体位置、影像与模型，未引入另一套天体数据。主带、木星特洛伊和海王星外天体点云读取现有三个 `public/catalogs/*.json` 固定样本；不会加载完整 SQLite 数据库或声称画出了全量目录。全屏漫游本身可在纯静态托管运行。

## 2026-09-12 小卫星点云

新增 `src/minor-moons.json` 记录从 OpenSpace `jup347.bsp`/`jup365.bsp`、`sat415.bsp`/`sat441.bsp`/`sat454.bsp`/`sat455.bsp`、`ura184` 三段和 `nep095.bsp`/`nep101xl-802.bsp`/`nep104.bsp` 读取的 **395 颗**木星、土星、天王星和海王星小卫星。脚本 `scripts/import-minor-moons.py` 只通过 HTTP Range 请求 SPK 头、段描述符和所需历元记录，使用同项目引用的行星 GM 转换为固定历元开普勒要素；不会把约 GB 级完整内核放进仓库。部分内卫星由 OpenSpace 内核的可用段覆盖，缺少可用椭圆段的对象会保留在 OpenSpace 原资产但不伪造轨道。

浏览器在太阳系总览和卫星系统视图显示这些小卫星的轨道点云；列表中 395 个点均可选择、搜索、跟踪，并支持 `?moon=<id>` 深链接。点大小为屏幕示意；没有为其虚构平均半径、表面影像或独立三维模型。它们与 46 个有模型/资料的主要天体共同形成 441 个可选条目。

路线固定进入时的 UTC 模拟日期，使用展示比例的同一空间坐标。停留位置、环绕角度、连接曲线、停留时长与避障区域由本应用为观看体验设计，不是 OpenSpace 记录的航天器轨迹，也不是按物理速度执行的飞行模拟。太阳程序外观、地月 Three.js 示例纹理、OpenSpace 影像/GLB 和纯色占位继续沿用原来源与限制；可选站点讲解注明目录抽样、缺测表面及艺术表示。
