# koishi-plugin-sauce-aggregator

[![npm](https://img.shields.io/npm/v/koishi-plugin-sauce-aggregator?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-sauce-aggregator)

聚合多个搜图引擎的搜索结果，并可从图源网站获取作品的详细信息。

## 功能

- **多引擎搜索**：支持 [SauceNAO](https://saucenao.com/)、[IQDB](https://www.iqdb.org/)、[Trace.moe](https://trace.moe/)、[搜图bot酱](https://soutubot.moe/)、[Ascii2D](https://ascii2d.net/) 和 [Yandex](https://ya.ru/)。
- **图源增强**：当搜索结果来自 [Pixiv](https://www.pixiv.net/)、[Danbooru](https://danbooru.donmai.us/)、[Gelbooru](https://gelbooru.com/) 或 [Yande.re](https://yande.re/post) 时，可获取作品详情、标签及原图。
- **搜索策略**：
  - **串行模式**：按顺序调用引擎，在找到高相似度结果后停止，资源占用较低。
  - **并行模式**：同时调用所有引擎，优先返回高相似度结果，响应速度较快。
- **多种输入**：支持指令后跟图片/URL、回复图片、或发送指令后等待用户发送图片。
- **链接解析**：可配置为自动解析消息中的图源链接，并发送作品详情。
- **图片预处理**：自动压缩体积过大的图片以符合各引擎的要求。

## 安装

可从 Koishi 插件市场搜索 `sauce-aggregator` 安装。

## 依赖项说明

部分引擎或图源需要额外配置或依赖项才能正常工作。

| 依赖项 | 引擎 | 图源 |
| :--- | :--- | :--- |
| **API 密钥/凭据** | `SauceNAO` | `Gelbooru`, `Danbooru`, `Pixiv` |
| **浏览器环境 (Puppeteer)** | `SoutuBot`, `Yandex`, `Ascii2D` | `Danbooru` |

## 指令说明

### `sauce [引擎名] <图片/URL>`

根据图片搜索，可指定引擎。

- **别名**: `搜图`, `soutu`
- **选项**:
  - `--all` / `-a`: 强制搜索所有已启用的引擎。
- **引擎别名**:
  - `saucenao (s)`, `iqdb (i)`, `tracemoe (t)`, `soutubot (b)`, `ascii2d (a)`, `yandex (y)`

#### 使用示例

```shell
# 默认搜索 (根据配置的搜索模式执行)
sauce [图片]

# 强制搜索所有已启用的引擎
sauce -a [图片]

# 指定单个引擎进行搜索 (支持全名或别名)
sauce saucenao [图片]
sauce b [图片]  # b 是 soutubot 的别名
```

## 配置项

### 基础设置

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `order` | `object` | - | 配置搜图引擎的启用状态和调用顺序。 |
| `enhancerOrder` | `object` | - | 配置图源增强的启用状态和调用顺序。 |
| `search.mode` | `string` | `sequential` | 搜索模式: `sequential` (串行) 或 `parallel` (并行)。 |
| `search.parallelHighConfidenceStrategy` | `string` | `first` | 并行模式下，高匹配度结果的返回策略: `first` (最先) 或 `all` (所有)。 |
| `confidenceThreshold` | `number` | `85` | 全局高匹配度阈值 (%)。 |
| `maxResults` | `number` | `2` | 无高匹配度结果时，每个引擎最多显示的低相似度结果数量。 |
| `promptTimeout` | `number` | `60` | 等待用户发送图片的超时时间 (秒)。 |
| `requestTimeout` | `number` | `30` | 全局网络请求超时时间 (秒)。 |
| `enhancerRetryCount` | `number` | `1` | 图源下载失败时的额外重试次数。 |
| `prependLinkParsingMiddleware` | `boolean` | `false` | 开启后，插件将优先处理图源链接，可能阻止其他同类插件生效。 |

---

### 浏览器设置

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `puppeteer.persistentBrowser` | `boolean` | `false` | 开启后，浏览器将常驻后台，加快响应速度但占用资源。 |
| `puppeteer.concurrency` | `number` | `1` | 浏览器并发任务数上限，建议为 1。 |
| `puppeteer.browserCloseTimeout` | `number` | `30` | (非常驻模式) 任务结束后，等待多少秒关闭浏览器。 |
| `puppeteer.browserLaunchTimeout` | `number` | `90` | 等待浏览器进程启动的最长时间 (秒)。 |
| `puppeteer.chromeExecutablePath`| `string` | - | (可选) 指定本地浏览器路径，留空则自动检测。 |

---

### 引擎配置

#### SauceNAO

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `apiKeys` | `string` | `[]` | SauceNAO 的 API Key 列表。可于注册登录 **[SauceNAO](https://saucenao.com/user.php)** 后，在 `Account` -> `api` 页面生成。 |
| `confidenceThreshold` | `number` | `85` | 独立高匹配度阈值 (%)，0 表示使用全局值。 |

#### Trace.moe

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `sendVideoPreview` | `boolean` | `true` | 发送高匹配度结果的视频预览。 |
| `confidenceThreshold` | `number` | `90` | 独立高匹配度阈值 (%)，0 表示使用全局值。 |

#### IQDB

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `confidenceThreshold` | `number` | `85` | 独立高匹配度阈值 (%)，0 表示使用全局值。 |

#### 搜图bot酱 (SoutuBot)

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `confidenceThreshold` | `number` | `65` | 独立高匹配度阈值 (%)，0 表示使用全局值。 |
| `maxHighConfidenceResults` | `number` | `3` | 高匹配度结果的最大显示数量。 |

#### Yandex

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `alwaysAttach` | `boolean` | `false` | 总是附加 Yandex 结果。 |
| `domain` | `string` | `ya.ru` | 搜索域名: `ya.ru` (推荐) 或 `yandex.com` (可能锁区)。 |

#### Ascii2D

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `alwaysAttach` | `boolean` | `false` | 总是附加 Ascii2D 结果。 |

---

### 图源配置

#### Yande.re

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `postQuality` | `string` | `jpeg` | 图片质量: `original`, `jpeg`, `sample`。 |
| `maxRating` | `string` | `s` | 最高内容评级: `s` (安全), `q` (可疑), `e` (露骨)。 |
| `enableLinkParsing` | `boolean` | `false`| 启用 `yande.re` 链接自动解析。 |

#### Gelbooru

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `keyPairs` | `object` | `[]` | API Key 对 (User ID 与 Key)。可于登录 **[Gelbooru](https://gelbooru.com/index.php?page=account&s=login&code=00)** 后，在 `My Account` -> `Options` 底部生成。 |
| `postQuality` | `string` | `sample` | 图片质量: `original`, `sample`, `preview`。 |
| `maxRating` | `string` | `general`| 最高内容评级: `general`, `sensitive`, `questionable`, `explicit`。 |
| `enableLinkParsing` | `boolean` | `false`| 启用 `gelbooru.com` 链接自动解析。 |

#### Danbooru

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `keyPairs` | `object` | `[]` | 用户凭据 (用户名与 API Key)。可于登录 **[Danbooru](https://danbooru.donmai.us/login?url=%2F)** 后，在 `My Account` -> 档案底部查看。 |
| `postQuality` | `string` | `sample` | 图片质量: `original`, `sample`, `preview`。 |
| `maxRating` | `string` | `general`| 最高内容评级: `general`, `sensitive`, `questionable`, `explicit`。 |
| `enableLinkParsing` | `boolean` | `false`| 启用 `danbooru.donmai.us` 链接自动解析。 |

#### Pixiv

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `refreshToken` | `string` | - | Pixiv API Refresh Token (必需)。**[获取教程](https://www.nanoka.top/posts/e78ef86/)**。 |
| `postQuality` | `string` | `large` | 图片质量: `original`, `large`, `medium`。 |
| `allowR18` | `boolean` | `false` | 是否允许发送 R-18/R-18G 内容。 |
| `maxImagesInPost`| `number` | `3` | 多图作品最大发送数量 (0 为无限制)。 |
| `enableLinkParsing`| `boolean`| `false`| 启用 `pixiv.net` 链接自动解析。 |

---

### 调试设置

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `debug.enabled` | `boolean` | `false` | 在控制台输出详细日志。 |
| `debug.logApiResponses`| `string`| `[]` | 记录指定引擎或图源的 API/HTML 原始响应。 |
