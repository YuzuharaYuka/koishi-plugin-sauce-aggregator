# koishi-plugin-sauce-aggregator

[![npm](https://img.shields.io/npm/v/koishi-plugin-sauce-aggregator?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-sauce-aggregator)

聚合多个搜图引擎，并从图源网站获取详细信息以增强搜索结果。

## 功能

- **多引擎支持**: 集成 `SauceNAO`, `IQDB`, `Trace.moe`, `搜图bot酱`, `Ascii2D`, `Yandex` 等搜图引擎。
- **图源详情增强**: 为高匹配度结果从 `Yande.re`, `Gelbooru`, `Danbooru`, `Pixiv` 获取高清图源及作品标签等详细信息。
- **可配置搜索策略**:
  - **串行模式**: 逐个调用引擎，找到高匹配度结果后立即停止，资源占用稳定。
  - **并行模式**: 同时调用所有引擎，以最快速度响应高匹配度结果，适合性能充足的环境。
- **灵活使用**: 支持指令后跟图片/URL、回复图片、或发送指令后等待图片。
- **图片自动预处理**: 自动压缩过大图片，以满足各引擎的 API 要求。

## 安装

在 Koishi 插件市场搜索 `sauce-aggregator` 并安装。

## 使用方法

**指令**: `sauce` (别名: `搜图`, `soutu`)

**使用示例**:
```shell
# 默认搜索 (根据配置的搜索模式执行)
sauce [图片]
sauce https://example.com/image.png

# 强制全量搜索所有已启用引擎
sauce --all [图片]

# 指定引擎搜索 (支持全名或别名)
sauce saucenao [图片]
sauce b [图片]
```
指令也可以通过回复图片，或在发送指令后等待图片输入的方式使用。

## 插件配置

所有选项均可在 Koishi 控制台内配置。

### 基础设置

- `搜索模式`: 默认搜索方式。
  - **串行模式**: 逐个调用引擎，找到高匹配度结果后停止。
  - **并行模式**: 同时调用所有引擎，响应速度更快但会瞬间占用更多资源。
- `并行模式策略`: 当“搜索模式”设为“并行”时生效。
  - **返回最先找到的结果**: 任何引擎找到高匹配度结果后就立即发送，忽略其他引擎后续的结果。
  - **返回所有高匹配度结果**: 将每个引擎找到的高匹配度结果都独立发送给用户。
- `引擎顺序`: 决定搜图引擎的调用顺序 (主要影响串行模式)。
- `图源顺序`: 决定结果增强时调用图源的顺序。
- `全局高匹配度阈值`: 当引擎未设置独立阈值时，将使用此值作为判断标准。
- `最大结果数`: 在未找到高匹配度结果时，每个引擎最多显示的结果数量。
- `发送图片超时`: 使用 `sauce` 指令后，等待用户发送图片的秒数。

### 引擎配置

#### SauceNAO
- `apiKeys`: SauceNAO 的 API Key 列表。
  - *获取方式*: 注册登录 `saucenao.com`，在 `Account` -> `api` -> `api key` 中生成。
- `独立高匹配度阈值`: 为 `SauceNAO` 单独设置阈值。设为 0 则使用全局阈值。

#### Trace.moe
- `sendVideoPreview`: 当找到高匹配度结果时，是否发送预览视频。
- `独立高匹配度阈值`: 为 `Trace.moe` 单独设置阈值。设为 0 则使用全局阈值。

#### IQDB
- `独立高匹配度阈值`: 为 `IQDB` 单独设置阈值。设为 0 则使用全局阈值。

#### 搜图bot酱 (SoutuBot)
- `独立高匹配度阈值`: 为 `搜图bot酱` 单独设置阈值。设为 0 则使用全局阈值。
- `高匹配度结果的最大显示数量`: 用于展示多个不同版本的匹配结果。

#### Yandex
- `domain`: 选择用于搜索的 Yandex 域名 (`ya.ru` 或 `yandex.com`)。
- `alwaysAttach`: 开启后，即使其他引擎找到高匹配度结果，也会附带 Yandex 的首个结果。
  - *注意*: 在并行模式下，此结果将作为独立消息稍后发送，以免拖慢主要结果的响应。

#### Ascii2D
- `alwaysAttach`: 开启后，即使其他引擎找到高匹配度结果，也会附带 Ascii2D 的首个结果。
  - *注意*: 在并行模式下，此结果将作为独立消息稍后发送，以免拖慢主要结果的响应。

### 图源配置

#### Yande.re
- `postQuality`: 获取图片的尺寸 (原图/中等图/预览图)。
- `maxRating`: 允许的最高内容评级。

#### Gelbooru
- `keyPairs`: Gelbooru 的 API Key 对 (User ID 与 API Key)。
  - *获取方式*: 注册登录 `gelbooru.com`，在 `My Account` -> `Options` -> `API Access Credentials` 中生成。
- `postQuality`: 获取图片的尺寸 (原图/预览图/缩略图)。
- `maxRating`: 允许的最高内容评级。

#### Danbooru
- `keyPairs`: Danbooru 的用户凭据 (用户名与 API Key)。
  - *获取方式*: 注册登录 `danbooru.donmai.us`，在 `My Account` -> `Profile` 底部 `API Key` 处生成。
- `postQuality`: 获取图片的尺寸 (原图/预览图/缩略图)。
- `maxRating`: 允许的最高内容评级。

#### Pixiv
- `refreshToken`: Pixiv API 的 Refresh Token (必需项)。
  - *获取教程*: [如何获取 Pixiv Refresh Token](https://www.nanoka.top/posts/e78ef86/)
- `postQuality`: 获取图片的尺寸 (原图/大图/中等图)。
- `allowR18`: 是否允许发送 R-18/R-18G 内容。

### 依赖项说明

| 依赖项 | 引擎 | 图源 |
| :--- | :--- | :--- |
| **API 密钥或凭据** | `SauceNAO` | `Gelbooru`, `Danbooru`, `Pixiv` |
| **浏览器环境 (Puppeteer)** | `SoutuBot`, `Yandex`, `Ascii2D` | `Danbooru` |

### 调试配置

- `enabled`: 启用调试模式，将在控制台输出详细的执行日志。
- `logApiResponses`: 选择要将 API 或页面原始返回信息输出到日志的引擎或图源。