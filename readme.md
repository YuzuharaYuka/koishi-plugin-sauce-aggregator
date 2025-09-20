# koishi-plugin-sauce-aggregator

[![npm](https://img.shields.io/npm/v/koishi-plugin-sauce-aggregator?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-sauce-aggregator)

聚合多个搜图引擎，并从图源网站获取详细信息以增强搜索结果。

## 功能特性

- **多引擎聚合**：集成 [SauceNAO](https://saucenao.com/)、[IQDB](https://www.iqdb.org/)、[Trace.moe](https://trace.moe/)、[搜图bot酱](https://soutubot.moe/)、[Ascii2D](https://ascii2d.net/) 和 [Yandex](https://ya.ru/)。
- **图源详情增强**：为高相似度结果从 [Pixiv](https://www.pixiv.net/)、[Danbooru](https://danbooru.donmai.us/)、[Gelbooru](https://gelbooru.com/)、[Yande.re](https://yande.re/post) 获取作品详情、标签及高清图片。
- **可配置搜索策略**：
  - **串行模式**：按顺序调用引擎，在找到高相似度结果后停止，资源占用稳定。
  - **并行模式**：同时调用所有引擎，以最快速度响应高相似度结果，适合对响应速度有要求的场景。
- **灵活的输入方式**：支持通过指令后跟图片/URL、回复图片、或发送指令后等待图片等方式进行搜索。
- **自动链接解析**：可配置为自动解析消息中出现的图源链接，并发送作品详情。
- **图片预处理**：自动压缩过大的图片以符合各引擎的 API 要求。

## 安装

前往 Koishi 插件市场搜索 `sauce-aggregator` 并安装。

## 使用说明

**基础指令**: `sauce` (别名: `搜图`, `soutu`)

**使用示例**:

```shell
# 默认搜索 (根据配置的搜索模式执行)
sauce [图片]
sauce https://example.com/image.png

# 强制搜索所有已启用的引擎
sauce --all [图片]
sauce -a [图片]

# 指定单个引擎进行搜索 (支持全名或别名)
sauce saucenao [图片]
sauce b [图片]
```

## 插件配置

所有选项均可在 Koishi 控制台内配置。

### 基础设置

- `引擎顺序`: 配置搜图引擎的启用状态和调用顺序。
- `图源顺序`: 配置结果增强图源的启用状态和调用顺序。
- `搜索模式`:
  - **串行模式**: 逐个调用引擎，找到高相似度结果后停止。
  - **并行模式**: 同时调用所有引擎，响应更快，但资源占用更高。
- `并行模式策略` (*仅并行模式生效*):
  - **返回最先找到的结果**: 任何引擎找到高相似度结果后立即发送，并终止其他引擎。
  - **返回所有高匹配度结果**: 将每个引擎找到的高相似度结果都独立发送。
- `全局高匹配度阈值`: 当引擎未设置独立阈值时，使用的相似度判断标准。
- `最大结果数`: 未找到高相似度结果时，每个引擎最多显示的低相似度结果数量。
- `发送图片超时`: 使用 `sauce` 指令后，等待用户发送图片的秒数。
- `全局网络请求超时`: 适用于所有搜图引擎和图源的网络请求超时时间（秒）。
- `启用前置中间件模式`: 开启后，插件将优先处理消息中的图源链接，可能阻止其他插件的链接解析功能。
- `图源下载重试次数`: 从图源网站下载图片失败时的额外尝试次数。

---

### 浏览器 (Puppeteer) 设置

*部分引擎依赖浏览器环境运行，此部分配置将影响它们的性能和稳定性。*

- `常驻浏览器`: 开启后，浏览器将在插件启动时预加载并常驻，加快后续响应速度，但会持续占用后台资源。
- `浏览器并发任务数`: 同时执行的浏览器任务上限。为避免资源过度消耗导致超时，建议设为 1。
- `自动关闭延迟`: *仅在关闭“常驻浏览器”时生效*。搜索任务结束后，等待指定秒数再关闭浏览器。
- `浏览器启动超时`: 等待浏览器进程启动并准备就緒的最长时间（秒）。
- `本地浏览器可执行文件路径`: （可选）指定本地 Chrome/Chromium 浏览器的路径。若留空，插件会尝试自动检测。

---

### 引擎配置

#### SauceNAO

- `apiKeys`: SauceNAO 的 API Key 列表。
- `独立高匹配度阈值`: 为该引擎单独设置阈值，设为 0 则使用全局值。

#### Trace.moe

- `sendVideoPreview`: 找到高相似度结果时，发送视频预览。
- `独立高匹配度阈值`: 为该引擎单独设置阈值，设为 0 则使用全局值。

#### IQDB

- `独立高匹配度阈值`: 为该引擎单独设置阈值，设为 0 则使用全局值。

#### 搜图bot酱 (SoutuBot)

- `独立高匹配度阈值`: 为该引擎单独设置阈值，设为 0 则使用全局值。
- `高匹配度结果的最大显示数量`: 用于展示多个不同版本的匹配结果。

#### Yandex

- `alwaysAttach`: 开启后，即使其他引擎找到高相似度结果，也会附带 Yandex 的首个结果。
- `domain`: 选择用于搜索的 Yandex 域名 (`ya.ru` 或 `yandex.com`)。

#### Ascii2D

- `alwaysAttach`: 开启后，即使其他引擎找到高相似度结果，也会附带 Ascii2D 的首个结果。

---

### 图源配置

#### Yande.re

- `postQuality`: 获取图片的尺寸 (`original`, `jpeg`, `sample`)。
- `maxRating`: 允许的最高内容评级 (`s`, `q`, `e`)。
- `enableLinkParsing`: 启用 `yande.re` 链接的自动解析。

#### Gelbooru

- `keyPairs`: Gelbooru 的 API Key 对 (User ID 与 API Key)。
- `postQuality`: 获取图片的尺寸 (`original`, `sample`, `preview`)。
- `maxRating`: 允许的最高内容评级 (`general`, `sensitive`, `questionable`, `explicit`)。
- `enableLinkParsing`: 启用 `gelbooru.com` 链接的自动解析。

#### Danbooru

- `keyPairs`: Danbooru 的用户凭据 (用户名与 API Key)。
- `postQuality`: 获取图片的尺寸 (`original`, `sample`, `preview`)。
- `maxRating`: 允许的最高内容评级 (`general`, `sensitive`, `questionable`, `explicit`)。
- `enableLinkParsing`: 启用 `danbooru.donmai.us` 链接的自动解析。

#### Pixiv

- `refreshToken`: Pixiv API 的 Refresh Token (必需项)。[获取教程](https://www.nanoka.top/posts/e78ef86/)。
- `postQuality`: 获取图片的尺寸 (`original`, `large`, `medium`)。
- `allowR18`: 是否允许发送 R-18/R-18G 内容。
- `maxImagesInPost`: 多图作品最大发送数量，设为 0 则无限制。
- `enableLinkParsing`: 启用 `pixiv.net` 链接的自动解析。

---

### 依赖项说明

| 依赖项 | 引擎 | 图源 |
| :--- | :--- | :--- |
| **API 密钥/凭据** | `SauceNAO` | `Gelbooru`, `Danbooru`, `Pixiv` |
| **浏览器环境 (Puppeteer)** | `SoutuBot`, `Yandex`, `Ascii2D` | `Danbooru` |

### 调试设置

- `enabled`: 启用调试模式，将在控制台输出详细的执行日志。
- `logApiResponses`: 选择要将 API 或页面原始返回信息输出到日志的引擎或图源。
