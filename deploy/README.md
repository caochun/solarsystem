# 192.168.30.134 部署

- 用户：`chun`
- 目录：`/home/chun/Develop/SolarSpace`
- 服务：`solarspace.service`，用户级 systemd
- 地址：`http://192.168.30.134:5173/`
- 监听：`0.0.0.0:5173`，所有 IPv4 网络接口

Node 18+ 提供 `dist/` 静态文件与 `/api/catalog/` 只读查询。全量搜索需要系统 `python3`（标准库 SQLite 含 FTS5/trigram，SQLite 3.34+）；目标机已验证 Python/SQLite 可用。无需在目标机安装 npm 包、Pillow 或科学计算包。Node 按需启动并管理一个 SQLite 查询进程，随同一 systemd 服务退出。

部署内容必须包含 `server.mjs`、`server/catalog-api.mjs`、`server/catalog_worker.py`、`dist/` 与 `data/catalog.sqlite`。约 762 MiB 的数据库位于静态根目录之外，浏览器不会下载它。若索引缺失，主要天体浏览、抽样点云和 CSV 下载继续可用，全量搜索显示服务未就绪。

服务单元安装于 `~/.config/systemd/user/solarspace.service`，用户 `Linger=yes`，退出 SSH 不会停止服务。

```sh
systemctl --user status solarspace
systemctl --user restart solarspace
systemctl --user stop solarspace
journalctl --user -u solarspace -n 50 --no-pager
```

更新数据时在开发机按主 README 执行导入脚本与 `scripts/index-catalogs.py`，然后 `npm test`、浏览器测试及 `npm run build`。先备份旧版；源码同步排除 `node_modules/`、`data-cache/`、`__pycache__/` 和测试产物。数据库单独上传临时文件，校验后替换；新 `dist/` 上传到临时目录，核对全部文件哈希后切换，并重启服务。`public/catalogs/` 和 `dist/catalogs/` 的完整 CSV.gz 要保留。

服务重启后检查实际 HTTP 就绪，再检查接口和监听：

```sh
systemctl --user is-active solarspace
ss -ltn 'sport = :5173'
curl -f 'http://127.0.0.1:5173/api/catalog/search?q=433'
```

服务单元有改动时：

```sh
install -m 644 ~/Develop/SolarSpace/deploy/solarspace.service ~/.config/systemd/user/solarspace.service
systemctl --user daemon-reload
systemctl --user enable --now solarspace
systemctl --user restart solarspace
```

可用 `HOST`、`PORT` 改监听地址，`SOLARSPACE_PYTHON` 指定 Python 路径，`SOLARSPACE_CATALOG_DB` 指定索引文件路径。数据库连接只读，替换索引后需要重启服务关闭旧连接。局域网 HTTP 的复制链接按钮可能提示手动复制地址栏；不影响三维渲染和全量查询。

沉浸漫游沿用同一入口和端口，打开页面按 F 即可启动。全屏由用户键盘或按钮操作触发，浏览器拒绝时自动使用页面沉浸布局。此次更新仅涉及前端代码与文档，现有数据库无需重新上传；备份源码和旧版 `dist/` 时可排除未变的 `data/`，保留服务器上的数据库。
