# koishi-plugin-sauce-aggregator

[![npm](https://img.shields.io/npm/v/koishi-plugin-sauce-aggregator?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-sauce-aggregator)

聚合多个搜图引擎，并从图源网站获取详细信息以增强搜索结果。

## 主要功能

- **多引擎支持**: 支持 `SauceNAO`, `IQDB`, `Trace.moe`, `Ascii2D`, `Yandex` 等搜图引擎。
- **图源详情增强**: 为高匹配度结果从 `Yande.re`, `Gelbooru`, `Danbooru` 获取高清图源及作品标签等详细信息。
- **多种搜索模式**:
  - **默认模式**: 按配置顺序搜索，找到高匹配度结果后立即停止。
  - **全量模式 (`--all`)**: 搜索所有已启用的引擎，并返回全部结果。
  - **指定引擎模式**: 只使用特定引擎进行搜索。
- **浏览器环境依赖**: 为绕过网站防护，部分引擎 (Yandex, Ascii2D, Danbooru) 调用浏览器实例进行搜索，响应速度相对较慢。
- **灵活使用**: 支持指令后跟图片/URL、回复图片、或发送指令后等待图片。
- **图片自动预处理**: 自动压缩过大图片，以满足各引擎的 API 要求。

## 安装

在 Koishi 插件市场搜索 `sauce-aggregator` 并安装。

## 使用方法

**指令**: `sauce` (别名: `搜图`, `soutu`)

**使用示例**:
```
# 默认搜索
sauce [图片]
sauce https://example.com/image.png

# 搜索所有已启用引擎
sauce --all [图片]

# 指定引擎搜索 (支持全名或别名)
sauce saucenao [图片]
sauce a [图片]

# 其他方式
- 回复一张图片，然后发送: sauce
- 直接发送 sauce，然后根据提示发送图片
```

## 插件配置

所有选项均可在 Koishi 控制台内配置。

### 主要选项

- **引擎顺序**: 拖拽排序，决定引擎的调用顺序。
- **图源顺序**: 拖拽排序，决定结果增强时调用图源的顺序。
- **高匹配度阈值**: 相似度高于此值的结果将被视为高匹配度结果，并中断后续搜索。
- **最大结果数**: 在未找到高匹配度结果时，每个引擎最多显示的结果数量。
- **发送图片超时**: 使用 `sauce` 指令后，等待用户发送图片的秒数。

### 引擎配置

#### SauceNAO
- **`apiKeys`**: SauceNAO 的 API Key 列表。
  - **获取**: 注册登录 `saucenao.com`，在 `Account` -> `api` -> `api key` 中生成。

#### Trace.moe
- **`sendVideoPreview`**: 当找到高匹配度结果时，是否发送预览视频。

#### Yandex
- **`domain`**: 选择用于搜索的 Yandex 域名 (`ya.ru` 或 `yandex.com`)。
- **`alwaysAttach`**: 开启后，即使其他引擎找到高匹配度结果，也会附带 Yandex 的首个结果作为补充。

#### Ascii2D
- **`alwaysAttach`**: 开启后，即使其他引擎找到高匹配度结果，也会附带 Ascii2D 的首个结果作为补充。

### 图源配置

#### Yande.re
- **`postQuality`**: 获取图片的尺寸 (原图/中等图/预览图)。
- **`maxRating`**: 允许的最高内容评级。

#### Gelbooru
- **`keyPairs`**: Gelbooru 的 API Key 对 (User ID 与 API Key)。
  - **获取**: 注册登录 `gelbooru.com`，在 `My Account` -> `Options` -> `API Access Credentials` 中生成。
- **`postQuality`**: 获取图片的尺寸 (原图/预览图/缩略图)。
- **`maxRating`**: 允许的最高内容评级。

#### Danbooru
- **`keyPairs`**: Danbooru 的用户凭据 (用户名与 API Key)。
  - **获取**: 注册登录 `danbooru.donmai.us`，在 `My Account` -> `Profile` 底部 `API Key` 处生成。
- **`postQuality`**: 获取图片的尺寸 (原图/预览图/缩略图)。
- **`maxRating`**: 允许的最高内容评级。

### 调试配置
- **`enabled`**: 启用调试模式，将在控制台输出详细的执行日志。
- **`logApiResponses`**: 选择要将 API 或页面原始返回信息输出到日志的引擎或图源。
```

--- END OF FILE readme.md ---
