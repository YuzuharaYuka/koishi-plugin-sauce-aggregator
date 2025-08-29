# koishi-plugin-sauce-aggregator

[![npm](https://img.shields.io/npm/v/koishi-plugin-sauce-aggregator?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-sauce-aggregator)

本插件聚合了多个搜图引擎，并使用图源网站增强搜索结果。

## 功能

- **引擎聚合**: 支持 SauceNAO, IQDB, Trace.moe。
- **图源增强**: 为高置信度结果从 Gelbooru 和 Yande.re 获取详细信息与高质量图片。
- **搜索模式**:
  - **默认**: 返回第一个高于置信度阈值的结果。
  - **全量 (`--all`)**: 返回所有已启用引擎的结果。
- **信息提取**:
  - **Trace.moe**: 识别番剧，提供标题、集数、时间轴与视频预览。
  - **SauceNAO**: 提供作品名、角色名与多来源链接 (Pixiv, Twitter 等)。
- **使用方式**: 支持指令后跟图片/URL、回复图片、发送指令后等待图片。
- **图片预处理**: 自动压缩过大图片以兼容API。

## 安装

于 Koishi 插件市场搜索 `sauce-aggregator` 并安装。

## 使用

**指令**: `sauce` (别名: `搜图`, `soutu`)

**示例**:
- `sauce [图片]`
- `sauce https://example.com/image.png`
- `sauce --all [图片]`
- 回复图片并发送 `sauce`
- 发送 `sauce` 后按提示发送图片

## 配置

所有选项均可在 Koishi 控制台内配置。

### 通用设置

- **引擎顺序**: 设置 SauceNAO, IQDB, Trace.moe 的调用顺序与开关。
- **图源顺序**: 设置 Gelbooru, Yande.re 的调用顺序与开关。
- **置信度阈值**: 高置信度结果的最低相似度 (%)。
- **最大结果数**: 无高置信度结果时，各引擎的最大显示数量。
- **等待超时**: 等待用户发送图片的秒数。

### 引擎设置

#### SauceNAO
- **`apiKeys`**: SauceNAO 的 API Key 列表。
  - **获取**: 登录 `saucenao.com`，在用户后台 `api` 页面生成。

#### Trace.moe
- **`sendVideoPreview`**: 是否发送高置信度结果的视频预览。

### 图源设置

#### Gelbooru
- **`keyPairs`**: Gelbooru 的 API Key 对 (User ID 与 API Key)。
  - **获取**: 登录 `gelbooru.com`，在 `My Account` -> `API` 选项卡生成。
- **`postQuality`**: 获取的图片尺寸 (原图/预览图/缩略图)。
- **`maxRating`**: 允许的最高内容评级。

#### Yande.re
- **`postQuality`**: 获取的图片尺寸 (原图/中等图/预览图)。
- **`maxRating`**: 允许的最高内容评级。

## License

MIT
