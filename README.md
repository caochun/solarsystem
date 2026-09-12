# 星际之间 · SolarSpace

基于 OpenSpace 资源的浏览器太阳系展示与交互应用，独立于 OpenSpace C++ 桌面程序。当前可选择 **152 个天体条目**：46 个有模型/资料的主要天体，加上 106 颗 OpenSpace 小卫星的轨道定位点；小卫星支持搜索、母行星导航、跟随观察和 `?moon=` 深链接，附 OpenSpace 引用的全部 16 类 JPL 小天体目录。

局域网已部署到 **http://192.168.30.134:5173/**，监听 `0.0.0.0:5173`，由用户级 `solarspace.service` 运行。管理方式见 [deploy/README.md](deploy/README.md)。

## 获取代码与本地运行

Web 版本作为独立仓库维护：[caochun/solarsystem](https://github.com/caochun/solarsystem)。仓库包含前端、服务端、导入脚本、测试、影像/模型和原始压缩目录；不包含 OpenSpace C++ 桌面工程、依赖安装目录、构建产物、下载缓存或生成的 SQLite 索引。

```sh
git clone git@github.com:caochun/solarsystem.git
cd solarsystem
```

需要 Node.js 22.12+（开发环境使用 Node 26）和 npm。在本目录运行：

```sh
npm ci
npm run dev
```

默认访问 **http://127.0.0.1:5173/**。开发服务仅绑定本机；端口占用时以终端输出为准。

新克隆需要从仓库内的压缩目录生成全量搜索索引，约占 762 MiB。需要 Python 3.11+，其 SQLite 须支持 FTS5 trigram；索引生成通常需要数分钟。未生成时，主要天体探索、漫游和抽样点云仍可使用；完整 API 测试与全量搜索测试需要先生成索引。

```sh
python3 scripts/index-catalogs.py
```

```sh
npm run build    # 类型检查和生产构建，产物为 dist/
npm run preview  # 本地预览生产版本，默认 http://127.0.0.1:4173/
```

生产环境可把 `dist/` 放到静态站点根目录，也可运行 `node server.mjs`（Node 18+），由 `HOST`、`PORT` 设置地址和端口。部署服务器提供 `dist/` 静态文件和 `/api/catalog/` 只读目录查询，不需要 npm 依赖。全量搜索另需系统 Python 3（含 SQLite FTS5/trigram）和 `data/catalog.sqlite`。仅使用静态托管时，抽样点云和下载仍可用，全量搜索/目录对象跟随需要接入本项目 API。目录中的 `.csv.gz` 必须作为 gzip 文件发送，不能设置 `Content-Encoding: gzip` 将其误当作预压缩 CSV；本项目开发、预览及生产服务已处理这一点。

运行库、影像、模型和目录均在本地，无第三方 CDN、字体或星历 API 运行时依赖。完整前端生产文件约 144 MiB，其中可下载目录压缩包约 101 MiB；打开首页不会下载这些压缩包，GLB 模型在选择对应天体或所属卫星系统后加载。另有约 762 MiB 的全量索引仅供服务器读取，浏览器不下载该数据库。未实现离线 Service Worker。

## 数据覆盖与交互

| 分组 | 当前覆盖 |
| --- | --- |
| 太阳与行星 | 太阳和全部八大行星；四个巨行星的环系统 |
| 地球、火星卫星 | 月球；火卫一、火卫二 |
| 木星卫星 | 木卫一至木卫四 |
| 土星卫星 | 土卫一至土卫八 |
| 天王星卫星 | 天卫一至天卫五 |
| 海王星卫星 | 海卫一、海卫二 |
| 冥王星卫星 | 冥卫一至冥卫五 |
| 五颗已确认矮行星 | 谷神星、冥王星、阋神星、妊神星、鸟神星 |
| 其他可选小天体 | 灶神星、塞德娜、创神星、共工星、亡神星 |
| 16 类小天体目录 | 近地小行星、主带、特洛伊、半人马、海王星外天体、多类彗星等；共 1,545,346 条分类记录，类别之间有重复 |

- 中文/英文名称搜索、按类别或母星系统筛选；点击天体、标签或列表跟随观察。
- 单体近景、卫星系统和太阳系总览；左键旋转、右键平移、滚轮缩放；触屏单指旋转，双指平移/缩放。按 R 或点击重置重新居中，自动清除旋转和平移惯性。
- 1900—2100 年 UTC 时间控制、播放/倒放、逐日调整、年度时间线和回到当前时刻。
- 展示比例与真实比例；轨道、标签、天然卫星、地球自转轴和全部行星环开关。
- 参考尺寸、距太阳/母星距离、公转周期和来源说明；补充 27 颗卫星及谷神星、灶神星共 29 个对象的 JPL 物理参数，展示质量、平均半径与密度及可用误差。质量上限明确标注。冥王星四颗小卫星使用 JPL 平均半径估计的等效球，不再使用历史尺寸占位。
- 顶栏九宫格打开小天体目录：切换类别、查询抽样记录、显示点云、下载完整 CSV.gz。每类通常最多 3,000 个抽样点，另保留少数著名天体；主带为 3,004 点，对应完整目录 1,365,050 条记录。输入名称、编号或临时编号可搜索当前类别或全部目录；纯数字按小行星编号精确匹配。每页 40 条，支持翻页和“定位并跟随”，选中对象显示独立开普勒轨道、随时间更新，并可用链接恢复。空查询下只列出部分样本。
- 可复制包含天体、时间、比例、卫星系统/总览、点云类别和所跟随目录对象的链接；支持窄屏布局。
- 沉浸式太阳系漫游：按 F 或点击顶栏 F，从太阳开始自动游览 32 个站点；默认一轮 11 分 12 秒，可循环或在完成后返回探索界面。
- 巨行星卫星系统会在总览或卫星系统视图中显示 106 颗 OpenSpace 小卫星的轨道点云；列表中的小卫星可直接选择并跟随，点云使用 SPK 历元状态转换的本地开普勒近似，未虚构表面尺寸或贴图。
- 快捷键：F 开始漫游，空格播放/暂停，1—8 按距日顺序选择行星，0 太阳，9 月球，R 重置视角。输入或对话框操作时不触发场景快捷键。

## 沉浸式太阳系漫游

F 请求浏览器全屏，隐藏导航、资料、时间轴、标签与轨道。控制面板在数秒后自动收起，默认不显示讲解文字；移动鼠标或轻触画面可再次唤出。若浏览器不支持或拒绝全屏，仍使用占满页面的沉浸布局。手机可点击顶栏 F 按钮，实际系统全屏能力取决于浏览器。

路线从太阳进入内太阳系，观察地月与火星卫星，穿行主小行星带并近看谷神星、灶神星；随后游览木星四大卫星、特洛伊小行星群、土星环及冰卫星，继续前往天王星、海王星、冥王星系统和海王星外天体点云，再近看妊神星、鸟神星、阋神星与塞德娜，最终拉远回望太阳系。系统镜头也展示未设置单独停留站的已收录卫星。

| 漫游操作 | 功能 |
| --- | --- |
| 空格 / 暂停按钮 | 暂停镜头，允许左键旋转、右键平移、滚轮缩放；再次继续时平滑回到路线 |
| ← / → | 平滑切换上一站 / 下一站 |
| N / 讲解按钮 | 显示或隐藏当前站点说明 |
| 速度、循环控件 | 选择 1× / 2× / 4×，控制是否重复播放 |
| F / Esc / 退出按钮 | 退出并恢复原视角、比例、图层、日期与模拟播放状态 |

漫游固定进入时的模拟日期，暂用展示比例，沿同一个时刻的天体位置进行空间导览；日期并不随镜头旅行前进。镜头绕开天体和行星环的包围区域，不代表真实飞行轨迹或速度。切换到后台自动暂停。退出浏览器全屏也会结束由本应用启动的全屏漫游；进入前已处于全屏时，退出漫游保留原全屏状态。

复用已有天体数据、影像、模型与三个本地点云样本，无需新增下载或天文 API。缺少表面影像的天体仍使用纯色模型，遥远天体艺术表面与目录抽样范围在站点说明中注明。这里展示已收录的数据与代表性路线，并未囊括所有已知太阳系天体。

## 数据与模型边界

**新增资源实际下载自 OpenSpace 引用的服务器，Three.js 负责渲染。** 首版地球、月球仍使用 Three.js 示例纹理；太阳是程序化示意。精确资源地址、版本、原资产路径及 SHA-256 见 [DATA_SOURCES.md](DATA_SOURCES.md) 和数据清单。

| 对象 | 浏览器位置模型 |
| --- | --- |
| 八大行星、月球、冥王星 | Astronomy Engine |
| 木星四大卫星 | Astronomy Engine 的 L1 解析模型 |
| 其他新增卫星 | 从 OpenSpace SPK 提取 2026-09-10 00:00 UTC 状态，转换为固定开普勒要素后外推 |
| 谷神星与目录点云 | OpenSpace 引用的 JPL SBDB 快照开普勒要素 |
| 其余可选小天体 | 原 OpenSpace `transforms.asset` 中的开普勒要素 |

浏览器没有运行完整 SPICE，也没有下载全部多 GB 星历内核。固定历元轨道只作展示，离历元越远，相位误差可能越大；未模拟长期摄动、非引力加速度、精确食现象或彗尾。日期范围表示控件支持范围，不是所有模型在该范围内的精度保证。

累计新增 15 张表面图和 6 个 GLB 模型，其中灶神星来自原 OpenSpace OBJ，约 80 万面简化为 8 万面，浏览器文件约 1.4 MB。没有全球影像的天体使用纯色椭球；遥远天体 GLB 的表面可能是艺术示意。部分卫星原资产把直径填入半径字段，现按同项目引用的 `pck00011.tpc` 校正；冥王星四颗小卫星采用 JPL 平均半径估计：冥卫二 18±1 km、冥卫三 18.5±1 km、冥卫四 6±1 km、冥卫五 5.2±1 km；均为等效球，未恢复真实不规则形状。新增卫星姿态为朝向母星的示意，不是精确自转模型。部分遥远天体尺寸为人工采用的观测估计值，详见来源说明。

真实比例统一缩放半径和距离；展示比例压缩行星/卫星间距及大小，并为小天体设最小可见尺寸，不能据画面量取物理比例。资料面板使用模型的物理单位。木星、天王星、海王星环来自 NASA PDS 参数，以圆形共面环带表示；颜色/亮度增强，展示比例下细环加宽，真实比例恢复来源宽度。Arago 环缺少宽度，仅在展示比例显示位置线；Le Verrier 环使用宽度上限。没有重建光学深度、环弧、偏心与完整垂直结构。土星环、地表光照、月相均为简化表示；没有地形瓦片、精确遮挡、内部结构或所有已知小卫星。

## 更新资源

导入需要上级 OpenSpace 源码的 `data/assets/` 和 `data/profiles/`、Python 3.11+、`curl`，以及 Pillow、NumPy、spiceypy、beautifulsoup4、trimesh、fast-simplification。构建全量索引还要求 Python 自带 SQLite 支持 FTS5 trigram（SQLite 3.34+）。仅部署 Web 目录的服务器无需运行导入。

```sh
python3 -m venv /tmp/solarspace-assets-venv
/tmp/solarspace-assets-venv/bin/pip install Pillow numpy spiceypy beautifulsoup4 trimesh fast-simplification
# 首版行星贴图与土星环，必要时重新导入
/tmp/solarspace-assets-venv/bin/python scripts/import-openspace.py --cache /tmp/solarspace-openspace-assets
# 完整目录必须先于新增天体导入：谷神星使用同一份 SBDB 快照
/tmp/solarspace-assets-venv/bin/python scripts/sync-catalogs.py
/tmp/solarspace-assets-venv/bin/python scripts/expand-system.py
/tmp/solarspace-assets-venv/bin/python scripts/verify-system.py
/tmp/solarspace-assets-venv/bin/python scripts/enrich-system.py
/tmp/solarspace-assets-venv/bin/python scripts/index-catalogs.py
npm test
npm run build
```

新增资源原件和 SPK 局部记录缓存在 `data-cache/openspace/`，重复执行可复用。缓存不随部署同步；`public/` 中的转换影像、原 GLB、抽样 JSON 和完整压缩目录随构建部署。原 OpenSpace 目录与星历更新的是 `.asset` 指定版本；补充物理参数来自脚本注明的 JPL/PDS 页面快照。均不在运行时访问外部天文 API。全量索引从完整 CSV.gz 重建，按 `full_name` 去重得到 1,542,803 个对象；重复记录保留全部类别，轨道选择最新有效历元。它不是不同名称/别名的天体身份归并。

## 工程结构与验证

| 文件 | 职责 |
| --- | --- |
| `src/openspace-data.json`、`src/extended-data.json`、`src/supplemental-data.json` | 尺寸、轨道、资源及审计清单 |
| `public/catalogs/*.meta.json`、`summary.json` | 目录来源、数量、抽样范围和校验值 |
| `scripts/resources.py`、`scripts/spk.py` | 缓存下载和 SPK 局部读取 |
| `scripts/sync-catalogs.py`、`expand-system.py` | 下载目录、影像、模型和提取轨道 |
| `scripts/verify-system.py` | 原生 CSPICE 对照及资源完整性校验 |
| `src/model.ts`、`src/kepler.ts` | 位置、父子关系、比例与轨道计算 |
| `src/scene.ts` | Three.js 场景、光照、相机、模型及点云 |
| `src/tour.ts`、`src/tour-path.ts` | 全屏漫游状态、控制面板、32 站路线与避障镜头 |
| `src/main.ts`、`src/catalogs.ts`、`src/style.css` | 页面、目录、时间状态与响应式交互 |
| `scripts/enrich-system.py` | JPL 物理参数、PDS 环参数与灶神星模型转换 |
| `scripts/index-catalogs.py`、`data/catalog.sqlite` | 完整目录去重及 FTS5 名称索引 |
| `server/catalog-api.mjs`、`server/catalog_worker.py` | Node API 与只读 Python SQLite 查询进程 |

```sh
npm test
npm run build
BROWSER_CHANNEL=msedge npm run test:browser
# 或安装 Playwright 浏览器后验证 WebKit
npx playwright install webkit
BROWSER_ENGINE=webkit npm run test:browser
```

数值、数据与 API 测试共 24 项，覆盖 CSPICE 参考状态、逆行/高偏心率轨道、46 个有模型天体父子关系与比例、106 颗小卫星导入及其前端条目、尺寸修正、所有完整目录解压校验，以及漫游路径在三个日期与横竖屏下的连续性、有限值和天体/行星环避障。原生验证另对 26 个 SPK 段各取三个时间检查读取结果；这验证读取与换算，不代表长期二体轨道准确。

浏览器测试共 19 项，覆盖筛选、卫星导航、按需模型、点云链接、实际下载解压、行星/时间/图层操作、右键平移与重置、三个新增环、全量目录搜索/跟随/链接恢复、无效轨道拒绝定位和 390px 窄屏；另验证漫游全屏及拒绝全屏回退、界面收起、暂停与平移、站点遍历、结束循环、视角/比例/播放恢复、异步目录链接和快速退出。截图保存在 `test-results/`。窄屏测试是浏览器模拟，尚未进行手机真机验证。可用 `BROWSER_BASE_URL` 指向已部署地址运行相同检查。

代码沿用 OpenSpace 项目的 [MIT 许可证](LICENSE.md)；运行库许可见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)，影像、模型与目录的来源和署名见 [DATA_SOURCES.md](DATA_SOURCES.md)。
