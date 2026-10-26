# koishi-plugin-sauce-aggregator

[![npm](https://img.shields.io/npm/v/koishi-plugin-sauce-aggregator?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-sauce-aggregator)

[Koishi](https://koishi.chat/) 的聚合搜图插件，同时查询多个搜图引擎，并从图源站获取作品详情与原图。

```bash
npm i koishi-plugin-sauce-aggregator
```

主指令 `sauce`（别名 `搜图` `soutu`）。

## 指令

| 用法 | 说明 |
| :--- | :--- |
| `sauce [图片/链接]` | 按配置的搜索模式搜图 |
| `sauce -a [图片]` | 搜索全部已启用的引擎 |
| `sauce <引擎> [图片]` | 只用一个引擎 |

支持三种给图方式：指令后跟图片或图片链接、回复带图的消息、先发指令再发图。

引擎可用全名或别名：`saucenao (s)`、`iqdb (i)`、`tracemoe (t)`、`soutubot (b)`、`ascii2d (a)`、`yandex (y)`、`googlelens (g)`。

## 搜图引擎

| 引擎 | 说明 |
| :--- | :--- |
| [SauceNAO](https://saucenao.com/) | 索引画师平台，查找同人图与插画，需 API Key |
| [IQDB](https://www.iqdb.org/) | 索引 Booru 类图站，查找壁纸与高清大图 |
| [Trace.moe](https://trace.moe/) | 识别番剧截图，给出番剧信息、集数与时间轴 |
| [搜图bot酱](https://soutubot.moe/) | 索引 E-Hentai / ExHentai / nHentai 等站点 |
| [Ascii2D](https://ascii2d.net/) | 识别推特同人图，作为补充结果 |
| [Yandex](https://ya.ru/) | 特征相似图与来源，作为补充结果 |
| [Google Lens](https://lens.google.com/) | 谷歌以图搜图，作为补充结果，需 SerpApi Key |

`saucenao`、`iqdb`、`tracemoe`、`soutubot` 参与「找到高匹配度结果即停止」的判定；
`ascii2d`、`yandex`、`googlelens` 为补充引擎，默认只在未找到高匹配度结果时补位，开启各自的「总是附加」后则每次展示；
`sauce -a` 会执行全部已启用引擎，不受该开关影响。

## 图源

| 图源 | 说明 |
| :--- | :--- |
| [Yande.re](https://yande.re/post) | 动漫游戏插画图站，高清壁纸与原画 |
| [Konachan](https://konachan.com/post) | 动漫壁纸站 |
| [Gelbooru](https://gelbooru.com/index.php?page=post&s=list&tags=all) | 综合图站，插画、漫画与同人作品 |
| [Danbooru](https://danbooru.donmai.us/) | 动漫艺术图站，标签与元数据详尽 |
| [Pixiv](https://www.pixiv.net/) | 画师原创插画与漫画社区 |

命中以上站点的结果会继续获取作品详情、标签与原图。访问受 App API 限制的 Pixiv 作品时，会自动回退到 Web API 补全公开信息。

## 依赖

| 依赖 | 涉及 |
| :--- | :--- |
| API Key / 凭据 | SauceNAO、Google Lens，以及 Gelbooru、Danbooru、Pixiv |
| 浏览器环境 | Yandex、Ascii2D |
| 公网图片链接 | Google Lens |

## 配置

多数选项在配置页均有说明，以下是常用项。

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `order` / `enhancerOrder` | 全部启用 | 引擎与图源的启用状态、调用顺序 |
| `search.mode` | `sequential` | `sequential` 串行 / `parallel` 并行 |
| `search.parallelHighConfidenceStrategy` | `first` | 并行模式下高匹配度结果的取法：`first` 最先 / `all` 全部 |
| `*.confidenceThreshold` | 见配置页 | 各引擎独立的高匹配度阈值（%），仅 SauceNAO、Trace.moe、IQDB、搜图bot酱可调 |
| `*.maxLowConfidenceResults` | 见配置页 | 各引擎低匹配度结果展示上限，`0` 不展示；Trace.moe 默认 `0` |
| `promptTimeout` | `60` | 等待用户发图的时长（秒） |
| `requestTimeout` | `30` | 网络请求超时（秒） |
| `image.maxEdge` | `2000` | 上传前把图片最长边缩到该像素，`0` 不缩放；搜图bot酱要求不超过 2000 |
| `image.maxSizeMB` | `2` | 上传前的体积上限（MB），`0` 不压缩 |
| `image.quality` | `90` | 重新编码为 JPEG 时的质量 |
| `iqdb.timeoutSeconds` | `20` | 等待 IQDB 结果的秒数，超时则跳过 IQDB |
| `iqdb.cooldownMinutes` | `10` | IQDB 排队超时后暂停使用的分钟数，`0` 不冷却 |
| `proxy` | `http://127.0.0.1:7890` | 独立代理，仅用于 Danbooru 图源与搜图bot酱、Yandex、Ascii2D 引擎 |
| `puppeteer.*` | 见配置页 | 浏览器服务方式、常驻、并发与超时 |
| `debug.enabled` | `false` | 输出调试日志 |

旧版全局 `confidenceThreshold`、`maxResults` 已移除，升级后请在对应引擎的设置中调整。

### 链接解析

各图源的 `enableLinkParsing` 默认关闭，开启后会自动识别消息中该站点的链接并回复作品详情与原图。
开启 `prependLinkParsingMiddleware` 可让本插件先于其他插件处理这些链接。

### 图片处理

上传前会把图片缩到最长边不超过 `image.maxEdge`（默认 2000）、体积不超过 `image.maxSizeMB`（默认 2MB）；
已合规的图片不会重新编码。支持 JPEG / PNG / WebP，GIF / BMP 超出限制时会原样上传。

## License

[MIT](https://github.com/YuzuharaYuka/koishi-plugin-sauce-aggregator/blob/master/LICENSE)
