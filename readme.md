# koishi-plugin-sauce-aggregator

[![npm](https://img.shields.io/npm/v/koishi-plugin-sauce-aggregator?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-sauce-aggregator)

[Koishi](https://koishi.chat/) 的聚合搜图插件。查询多个搜图引擎，并从图源站获取作品详情与原图。

```bash
npm i koishi-plugin-sauce-aggregator
```

主指令 `sauce`（别名 `搜图`、`soutu`）。

## 指令

| 用法 | 说明 |
| :--- | :--- |
| `sauce [图片/链接]` | 按配置的搜索模式搜图 |
| `sauce -a [图片]` | 搜索全部已启用的引擎 |
| `sauce <引擎> [图片]` | 只使用一个引擎 |

支持三种给图方式：指令后跟图片或链接、回复带图的消息、先发指令再发图。

引擎可用全名或别名：`saucenao (s)`、`iqdb (i)`、`tracemoe (t)`、`soutubot (b)`、`ascii2d (a)`、`yandex (y)`、`googlelens (g)`。

## 搜图引擎

| 引擎 | 说明 |
| :--- | :--- |
| [SauceNAO](https://saucenao.com/) | 同人图与插画检索，需 API Key |
| [IQDB](https://www.iqdb.org/) | Booru 图站，检索壁纸与高清图 |
| [Trace.moe](https://trace.moe/) | 识别番剧截图，给出番剧、集数与时间轴 |
| [搜图bot酱](https://soutubot.moe/) | 索引 E-Hentai、ExHentai、nHentai 等站点 |
| [Ascii2D](https://ascii2d.net/) | 推特同人图检索 |
| [Yandex](https://ya.ru/) | 相似图与来源 |
| [Google Lens](https://lens.google.com/) | 谷歌以图搜图，需 SerpApi Key |

`saucenao`、`iqdb`、`tracemoe`、`soutubot` 参与高匹配度判定；`ascii2d`、`yandex`、`googlelens` 默认作为补充，开启「总是附加」后每次展示。
`sauce -a` 执行全部已启用引擎。

## 图源

| 图源 | 说明 |
| :--- | :--- |
| [Yande.re](https://yande.re/post) | 动漫游戏图站 |
| [Konachan](https://konachan.com/post) | 动漫壁纸站 |
| [Gelbooru](https://gelbooru.com/index.php?page=post&s=list&tags=all) | 综合图站，插画、漫画与同人作品 |
| [Danbooru](https://danbooru.donmai.us/) | 动漫图站 |
| [Pixiv](https://www.pixiv.net/) | 画师插画与漫画 |

命中后获取作品详情、标签与原图。

## 配置

| 部分配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `order` / `enhancerOrder` | 全部启用 | 引擎与图源的启用状态、调用顺序 |
| `search.mode` | `sequential` | `sequential` 串行 / `parallel` 并行 |
| `*.confidenceThreshold` | 见配置页 | 引擎的高匹配度阈值（%），仅 SauceNAO、Trace.moe、IQDB、搜图bot酱可调 |
| `*.maxLowConfidenceResults` | 见配置页 | 低匹配度结果展示上限，`0` 不展示；Trace.moe 默认 `0` |
| `*.sendImages` | `true` | 是否发送图片；关闭后只发文字，图源图片不受影响 |
| `image.maxEdge` | `2000` | 上传前最长边上限（像素），`0` 不缩放；搜图bot酱要求不超过 2000 |
| `image.maxSizeMB` | `2` | 上传前体积上限（MB），`0` 不压缩 |
| `proxy` | `http://127.0.0.1:7890` | 独立代理，仅用于 Danbooru 图源，以及搜图bot酱、Yandex、Ascii2D 引擎 |
| `puppeteer.provider` | `internal` | `internal` 插件内置 / `global` 全局浏览器服务 |

需要 API Key：SauceNAO、Google Lens

需要账号凭据：Gelbooru、Danbooru、Pixiv

需要 `puppeteer` 浏览器环境：Yandex、Ascii2D

### 链接解析

各图源的 `enableLinkParsing` 默认关闭；开启后识别消息中的链接并回复作品详情与原图。
`prependLinkParsingMiddleware` 配置项可让本插件优先处理这些链接。

### 图片处理

上传前将图片缩到最长边不超过 `image.maxEdge`、体积不超过 `image.maxSizeMB`；已合规图片不重新编码。
支持 JPEG / PNG / WebP，GIF / BMP 超限时原样上传。

## License

[MIT](https://github.com/YuzuharaYuka/koishi-plugin-sauce-aggregator/blob/master/LICENSE)
