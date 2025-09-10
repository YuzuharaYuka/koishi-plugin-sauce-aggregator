var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  usage: () => usage,
  using: () => using
});
module.exports = __toCommonJS(index_exports);
var import_koishi15 = require("koishi");

// src/config.ts
var import_koishi = require("koishi");
var Config = import_koishi.Schema.object({
  order: import_koishi.Schema.array(import_koishi.Schema.object({
    engine: import_koishi.Schema.union(["saucenao", "iqdb", "tracemoe", "soutubot", "yandex", "ascii2d"]).description("搜图引擎"),
    enabled: import_koishi.Schema.boolean().default(true).description("是否启用")
  })).role("table").default([
    { engine: "saucenao", enabled: true },
    { engine: "iqdb", enabled: true },
    { engine: "tracemoe", enabled: true },
    { engine: "soutubot", enabled: true },
    { engine: "ascii2d", enabled: true },
    { engine: "yandex", enabled: true }
  ]).description("搜图引擎。将按顺序调用，找到高匹配度结果后即停止（除非使用 --all）。\n注意：Yandex 和 Ascii2D 通常建议作为附加结果使用。"),
  enhancerOrder: import_koishi.Schema.array(import_koishi.Schema.object({
    engine: import_koishi.Schema.union(["gelbooru", "yandere", "danbooru"]).description("图源"),
    enabled: import_koishi.Schema.boolean().default(true).description("是否启用")
  })).role("table").default([
    { engine: "yandere", enabled: true },
    { engine: "gelbooru", enabled: true },
    { engine: "danbooru", enabled: true }
  ]).description("结果增强图源。在此处启用并排序，找到高匹配度结果后，将按此顺序尝试获取更详细信息。"),
  confidenceThreshold: import_koishi.Schema.number().default(85).min(0).max(100).description("全局高匹配度阈值 (%)。当引擎未设置独立阈值时，将使用此值。"),
  maxResults: import_koishi.Schema.number().default(2).description("低匹配度结果的最大显示数量。当没有找到高匹配度结果时，每个引擎最多显示的结果数。"),
  promptTimeout: import_koishi.Schema.number().default(60).description("发送图片超时 (秒)。使用 `sauce` 指令后等待用户发送图片的超时时间。"),
  requestTimeout: import_koishi.Schema.number().default(30).min(5).description("全局网络请求超时 (秒)。适用于所有搜图引擎和图源增强器。"),
  chromeExecutablePath: import_koishi.Schema.string().description(
    "本地浏览器可执行文件路径 (可选)。\n\n插件会优先使用此路径。如果留空，将尝试自动检测。"
  ),
  saucenao: import_koishi.Schema.object({
    apiKeys: import_koishi.Schema.array(import_koishi.Schema.string().role("secret")).description("SauceNAO 的 API Key 列表。\n\n注册登录 saucenao.com，在底部选项 `Account` -> `api` -> `api key`中生成。\n\n将api key: 后字符串完整复制并填入。"),
    confidenceThreshold: import_koishi.Schema.number().min(0).max(100).default(85).description("独立高匹配度阈值 (%)。如果设置为 0，将使用全局阈值。")
  }).description("SauceNAO 设置"),
  tracemoe: import_koishi.Schema.object({
    sendVideoPreview: import_koishi.Schema.boolean().default(true).description("发送视频预览。当 Trace.moe 找到高匹配度结果时，是否发送预览视频。"),
    confidenceThreshold: import_koishi.Schema.number().min(0).max(100).default(90).description("独立高匹配度阈值 (%)。如果设置为 0，将使用全局阈值。")
  }).description("Trace.moe 设置"),
  iqdb: import_koishi.Schema.object({
    confidenceThreshold: import_koishi.Schema.number().min(0).max(100).default(85).description("独立高匹配度阈值 (%)。如果设置为 0，将使用全局阈值。")
  }).description("IQDB 设置"),
  soutubot: import_koishi.Schema.object({
    confidenceThreshold: import_koishi.Schema.number().min(0).max(100).default(70).description("独立高匹配度阈值 (%)。如果设置为 0，将使用全局阈值。"),
    maxHighConfidenceResults: import_koishi.Schema.number().min(1).max(10).default(3).description("高匹配度结果的最大显示数量。用于展示多个不同版本（如语言）的匹配结果。")
  }).description("搜图bot酱 设置"),
  yandex: import_koishi.Schema.object({
    alwaysAttach: import_koishi.Schema.boolean().default(false).description("总是附加 Yandex 结果。开启后，即使其他引擎找到高匹配度结果，也会附带 Yandex 的首个结果。"),
    domain: import_koishi.Schema.union([
      import_koishi.Schema.const("ya.ru").description("ya.ru (推荐)"),
      import_koishi.Schema.const("yandex.com").description("yandex.com")
    ]).default("ya.ru").description("选择用于搜索的 Yandex 域名。如果遇到访问问题或搜索无结果，可以尝试切换。")
  }).description("Yandex 设置"),
  ascii2d: import_koishi.Schema.object({
    alwaysAttach: import_koishi.Schema.boolean().default(false).description("总是附加 Ascii2D 结果。开启后，即使其他引擎找到高匹配度结果，也会附带 Ascii2D 的首个结果。")
  }).description("Ascii2D 设置"),
  yandere: import_koishi.Schema.object({
    postQuality: import_koishi.Schema.union([
      import_koishi.Schema.const("original").description("原图"),
      import_koishi.Schema.const("jpeg").description("中等图"),
      import_koishi.Schema.const("sample").description("预览图")
    ]).default("jpeg").description("图片质量。从 Yande.re 获取的图片尺寸。"),
    maxRating: import_koishi.Schema.union([
      import_koishi.Schema.const("s").description("安全"),
      import_koishi.Schema.const("q").description("可疑"),
      import_koishi.Schema.const("e").description("露骨")
    ]).default("s").description("允许的最高内容评级。")
  }).description("Yande.re 图源设置"),
  gelbooru: import_koishi.Schema.object({
    keyPairs: import_koishi.Schema.array(import_koishi.Schema.object({
      userId: import_koishi.Schema.string().description("User ID").required(),
      apiKey: import_koishi.Schema.string().role("secret").description("API Key").required()
    })).description("Gelbooru API Key 对 (User ID 与 Key)。\n\n注册登录 gelbooru.com，在 `My Account` -> `Options` 底部选项卡``API Access Credentials``中生成。\n\n形如`&api_key={ API Key }&user_id={ User ID }` { }中的才是需要填入的。"),
    postQuality: import_koishi.Schema.union([
      import_koishi.Schema.const("original").description("原图"),
      import_koishi.Schema.const("sample").description("预览图"),
      import_koishi.Schema.const("preview").description("缩略图")
    ]).default("sample").description("图片质量。从 Gelbooru 获取的图片尺寸。"),
    maxRating: import_koishi.Schema.union([
      import_koishi.Schema.const("general").description("通用"),
      import_koishi.Schema.const("sensitive").description("敏感"),
      import_koishi.Schema.const("questionable").description("可疑"),
      import_koishi.Schema.const("explicit").description("露骨")
    ]).default("general").description("允许的最高内容评级。")
  }).description("Gelbooru 图源设置"),
  danbooru: import_koishi.Schema.object({
    keyPairs: import_koishi.Schema.array(import_koishi.Schema.object({
      username: import_koishi.Schema.string().description("用户名 (Login Name)").required(),
      apiKey: import_koishi.Schema.string().role("secret").description("API Key").required()
    })).description("Danbooru API 用户凭据 (用户名与 API Key)。\n\n注册登录 danbooru.donmai.us，在 `My Account` -> `Profile` 底部 `API Key` 处生成。"),
    postQuality: import_koishi.Schema.union([
      import_koishi.Schema.const("original").description("原图"),
      import_koishi.Schema.const("sample").description("预览图 (大尺寸)"),
      import_koishi.Schema.const("preview").description("缩略图 (小尺寸)")
    ]).default("sample").description("图片质量。从 Danbooru 获取的图片尺寸。"),
    maxRating: import_koishi.Schema.union([
      import_koishi.Schema.const("general").description("通用 (g)"),
      import_koishi.Schema.const("sensitive").description("敏感 (s)"),
      import_koishi.Schema.const("questionable").description("可疑 (q)"),
      import_koishi.Schema.const("explicit").description("露骨 (e)")
    ]).default("general").description("允许的最高内容评级。")
  }).description("Danbooru 图源设置"),
  debug: import_koishi.Schema.object({
    enabled: import_koishi.Schema.boolean().default(false).description("启用调试模式。将在控制台输出详细的执行日志。"),
    logApiResponses: import_koishi.Schema.array(import_koishi.Schema.union(["saucenao", "iqdb", "tracemoe", "yandex", "ascii2d", "soutubot", "gelbooru", "yandere", "danbooru"])).role("checkbox").default([]).description("记录 API 响应。选择要将 API 或页面原始返回信息输出到日志的引擎/图源 (可能产生大量日志)。")
  }).description("调试设置").default({
    enabled: false,
    logApiResponses: []
  })
});

// src/searchers/saucenao.ts
var import_koishi2 = require("koishi");
var logger = new import_koishi2.Logger("sauce-aggregator");
var saucenaoIndexMap = {
  0: "H-Mags",
  2: "H-Game CG",
  4: "HCG",
  5: "Pixiv",
  6: "Pixiv Historical",
  8: "Nico Nico Seiga",
  9: "Danbooru",
  10: "Drawr",
  11: "Nijie",
  12: "Yande.re",
  16: "FAKKU",
  18: "H-Misc (nhentai)",
  19: "2D-Market",
  20: "MediBang",
  21: "Anime",
  22: "H-Anime",
  23: "Movies",
  24: "Shows",
  25: "Gelbooru",
  26: "Konachan",
  27: "Sankaku Channel",
  28: "Anime-Pictures",
  29: "e621",
  30: "Idol Complex",
  31: "BCY Illust",
  32: "BCY Cosplay",
  33: "PortalGraphics",
  34: "deviantArt",
  35: "Pawoo",
  36: "Madokami",
  37: "MangaDex",
  38: "H-Misc (e-hentai)",
  39: "ArtStation",
  40: "FurAffinity",
  41: "Twitter",
  42: "Furry Network",
  43: "Kemono",
  44: "Skeb"
};
var SauceNAO = class {
  constructor(ctx, config, debugConfig, requestTimeout) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.timeout = requestTimeout * 1e3;
  }
  static {
    __name(this, "SauceNAO");
  }
  name = "saucenao";
  keyIndex = 0;
  timeout;
  async search(options) {
    const apiKeys = this.config.apiKeys;
    if (!apiKeys || apiKeys.length === 0) {
      logger.warn("[saucenao] 未配置任何 API Key。");
      return [];
    }
    const currentApiKey = apiKeys[this.keyIndex];
    if (this.debugConfig.enabled) {
      logger.info(`[saucenao] 使用 API Key 列表中的第 ${this.keyIndex + 1} 个 Key。`);
    }
    this.keyIndex = (this.keyIndex + 1) % apiKeys.length;
    const form = new FormData();
    form.append("output_type", "2");
    form.append("api_key", currentApiKey);
    const safeBuffer = Buffer.from(options.imageBuffer);
    form.append("file", new Blob([safeBuffer]), options.fileName);
    const url = "https://saucenao.com/search.php";
    if (this.debugConfig.enabled) logger.info(`[saucenao] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`);
    try {
      const data = await this.ctx.http.post(url, form, { timeout: this.timeout });
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger.info(`[saucenao] 收到响应: ${JSON.stringify(data, null, 2)}`);
      }
      if (!data?.header) {
        logger.warn("[saucenao] 响应格式不正确，缺少 header。");
        return [];
      }
      if (data.header.status > 0) {
        throw new Error(`API 返回错误: ${data.header.message || "未知服务器端错误"}`);
      }
      if (data.header.status < 0) {
        if (data.header.message.includes("Search Rate Too High")) {
          throw new Error("搜索过于频繁 (30秒内限制)，请稍后再试。");
        }
        if (data.header.message.includes("Daily Search Limit Exceeded")) {
          throw new Error("今日搜索额度已用尽，请检查或更换 API Key。");
        }
        throw new Error(`API 返回错误: ${data.header.message || "未知客户端错误"}`);
      }
      if (!data.results) return [];
      return data.results.filter((res) => res?.header?.similarity && res?.data?.ext_urls?.length > 0).map((res) => {
        const { header, data: data2 } = res;
        const ext_urls = data2.ext_urls;
        const details = [];
        const sourceEngine = saucenaoIndexMap[header.index_id] || header.index_name.split(" - ")[0];
        if (data2.material) details.push(`作品: ${data2.material}`);
        if (data2.characters) details.push(`角色: ${data2.characters}`);
        if (data2.company) details.push(`公司: ${data2.company}`);
        if (data2.part) details.push(`集数: ${data2.part}`);
        if (data2.year) details.push(`年份: ${data2.year}`);
        if (data2.est_time) details.push(`时间: ${data2.est_time}`);
        const allUrls = [...new Set([data2.source, ...ext_urls].filter(Boolean))];
        allUrls.forEach((url2) => {
          if (url2 === ext_urls[0]) return;
          let siteName = "其他来源";
          if (url2.includes("pixiv.net")) siteName = "Pixiv";
          else if (url2.includes("twitter.com")) siteName = "Twitter";
          else if (url2.includes("danbooru.donmai.us")) siteName = "Danbooru";
          else if (url2.includes("gelbooru.com")) siteName = "Gelbooru";
          else if (url2.includes("yande.re")) siteName = "Yande.re";
          else if (url2.includes("konachan.com")) siteName = "Konachan";
          else if (url2.includes("mangadex.org")) siteName = "MangaDex";
          else if (url2.includes("anidb.net")) siteName = "AniDB";
          else if (url2.includes("myanimelist.net")) siteName = "MyAnimeList";
          else if (url2.includes("anilist.co")) siteName = "Anilist";
          else if (url2.includes("e-hentai.org")) siteName = "E-Hentai";
          else if (url2.includes("nhentai.net")) siteName = "nhentai";
          else if (url2.includes("artstation.com")) siteName = "ArtStation";
          else if (url2.includes("deviantart.com")) siteName = "DeviantArt";
          else if (url2.includes("furaffinity.net")) siteName = "FurAffinity";
          details.push(`${siteName}: ${url2}`);
        });
        return {
          thumbnail: header.thumbnail,
          similarity: parseFloat(header.similarity),
          url: ext_urls[0],
          source: `[${sourceEngine}] ${data2.title || data2.material || "未知作品"}`,
          author: data2.member_name || (Array.isArray(data2.creator) ? data2.creator.join(", ") : data2.creator) || "未知作者",
          details
        };
      });
    } catch (error) {
      logger.warn(`[saucenao] 请求出错: ${error.message}`);
      if (this.debugConfig.enabled && error.response) {
        logger.debug(`[saucenao] 响应状态: ${error.response.status}`);
        logger.debug(`[saucenao] 响应数据: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
};

// src/searchers/tracemoe.ts
var import_koishi3 = require("koishi");
var logger2 = new import_koishi3.Logger("sauce-aggregator");
var TraceMoe = class {
  constructor(ctx, config, debugConfig, requestTimeout) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.timeout = requestTimeout * 1e3;
  }
  static {
    __name(this, "TraceMoe");
  }
  name = "tracemoe";
  timeout;
  async search(options) {
    const form = new FormData();
    const safeBuffer = Buffer.from(options.imageBuffer);
    form.append("image", new Blob([safeBuffer]), options.fileName);
    const url = "https://api.trace.moe/search?cutBorders&anilistInfo";
    if (this.debugConfig.enabled) logger2.info(`[tracemoe] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`);
    try {
      const data = await this.ctx.http.post(url, form, { timeout: this.timeout });
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger2.info(`[tracemoe] 收到响应: ${JSON.stringify(data, null, 2)}`);
      }
      if (data.error) {
        throw new Error(`API 返回错误: ${data.error}`);
      }
      const { result } = data;
      if (!result || result.length === 0) return [];
      const uniqueResults = [];
      const seen = /* @__PURE__ */ new Set();
      for (const res of result) {
        const uniqueKey = `${res.anilist?.id}-${res.episode}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          uniqueResults.push(res);
        }
      }
      return uniqueResults.slice(0, options.maxResults).map((res) => {
        const { anilist, episode, from, similarity, image, video } = res;
        const titles = anilist?.title || {};
        const details = [];
        if (titles.chinese && titles.romaji && titles.chinese !== titles.romaji) details.push(`罗马音: ${titles.romaji}`);
        if (titles.english) details.push(`英文: ${titles.english}`);
        const status = anilist.status ? anilist.status.charAt(0) + anilist.status.slice(1).toLowerCase() : null;
        if (anilist.isAdult) details.push(`分级: R18+`);
        if (anilist.synonyms?.length > 0) details.push(`别名: ${anilist.synonyms.join(", ")}`);
        const year = anilist.startDate?.year;
        const season = anilist.season ? anilist.season.charAt(0) + anilist.season.slice(1).toLowerCase() : null;
        const format = anilist.format?.replace("_", " ");
        const episodes = anilist.episodes;
        const animeInfo = [year, season, format, episodes ? `${episodes} 集` : null, status].filter(Boolean).join(" · ");
        if (animeInfo) details.push(`信息: ${animeInfo}`);
        if (anilist.genres?.length > 0) details.push(`类型: ${anilist.genres.join(", ")}`);
        const mainStudio = anilist.studios?.edges?.find((e) => e.isMain)?.node.name;
        if (mainStudio) details.push(`工作室: ${mainStudio}`);
        const officialSite = anilist.externalLinks?.find((l) => l.site === "Official Site")?.url;
        if (officialSite) details.push(`官网: ${officialSite}`);
        if (anilist.idMal) details.push(`MyAnimeList: https://myanimelist.net/anime/${anilist.idMal}`);
        if (anilist.siteUrl) details.push(`Anilist: https://anilist.co/anime/${anilist.siteUrl}`);
        const formatTime = /* @__PURE__ */ __name((seconds) => {
          const h9 = Math.floor(seconds / 3600).toString().padStart(2, "0");
          const m = Math.floor(seconds % 3600 / 60).toString().padStart(2, "0");
          const s = Math.floor(seconds % 60).toString().padStart(2, "0");
          return `${h9}:${m}:${s}`;
        }, "formatTime");
        return {
          thumbnail: image,
          similarity: similarity * 100,
          url: video,
          source: titles.chinese || titles.romaji || "未知动漫",
          author: `第 ${episode || "N/A"} 集`,
          time: formatTime(from),
          details,
          coverImage: anilist.coverImage?.extraLarge || anilist.coverImage?.large
        };
      });
    } catch (error) {
      logger2.warn(`[tracemoe] 请求出错: ${error.message}`);
      if (this.debugConfig.enabled && error.response) {
        logger2.debug(`[tracemoe] 响应状态: ${error.response.status}`);
        logger2.debug(`[tracemoe] 响应数据: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
};

// src/searchers/iqdb.ts
var import_koishi5 = require("koishi");
var cheerio = __toESM(require("cheerio"));

// src/utils.ts
var import_buffer = require("buffer");
var import_pureimage = require("pureimage");
var import_stream = require("stream");
var import_koishi4 = require("koishi");
var logger3 = new import_koishi4.Logger("sauce-aggregator:utils");
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
function getImageTypeFromUrl(url) {
  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}
__name(getImageTypeFromUrl, "getImageTypeFromUrl");
function detectImageType(buffer) {
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "jpeg";
  if (buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71) return "png";
  return null;
}
__name(detectImageType, "detectImageType");
async function preprocessImage(buffer, maxSizeInMB = 4) {
  const ONE_MB = 1024 * 1024;
  if (buffer.length <= maxSizeInMB * ONE_MB) return buffer;
  logger3.info(`图片体积 (${(buffer.length / ONE_MB).toFixed(2)}MB) 超出 ${maxSizeInMB}MB，正在压缩...`);
  try {
    const imageType = detectImageType(buffer);
    if (!imageType) {
      logger3.warn(`[preprocess] 不支持的图片格式，无法压缩。将使用原图。`);
      return buffer;
    }
    const stream = import_stream.Readable.from(buffer);
    const image = imageType === "jpeg" ? await (0, import_pureimage.decodeJPEGFromStream)(stream) : await (0, import_pureimage.decodePNGFromStream)(stream);
    const MAX_DIMENSION = 2e3;
    const ratio = Math.min(MAX_DIMENSION / image.width, MAX_DIMENSION / image.height, 1);
    const newWidth = Math.round(image.width * ratio);
    const newHeight = Math.round(image.height * ratio);
    const newCanvas = (0, import_pureimage.make)(newWidth, newHeight);
    const ctx = newCanvas.getContext("2d");
    ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, newWidth, newHeight);
    const passThrough = new import_stream.PassThrough();
    const chunks = [];
    passThrough.on("data", (chunk) => chunks.push(chunk));
    const encodePromise = imageType === "jpeg" ? (0, import_pureimage.encodeJPEGToStream)(newCanvas, passThrough, 90) : (0, import_pureimage.encodePNGToStream)(newCanvas, passThrough);
    await encodePromise;
    const finalBuffer = import_buffer.Buffer.concat(chunks);
    logger3.info(`[preprocess] 图片压缩完成，新体积: ${(finalBuffer.length / ONE_MB).toFixed(2)}MB`);
    return finalBuffer;
  } catch (error) {
    logger3.error("图片压缩失败:", error);
    return buffer;
  }
}
__name(preprocessImage, "preprocessImage");
function getImageUrlAndName(session, text) {
  let elements = session.elements;
  if (session.quote) elements = session.quote.elements;
  const imgElement = elements?.find((e) => e.type === "img");
  let url;
  if (imgElement?.attrs.src) url = imgElement.attrs.src;
  if (!url && text) {
    try {
      const potentialUrl = text.trim();
      new URL(potentialUrl);
      if (potentialUrl.startsWith("http")) url = potentialUrl;
    } catch (_) {
    }
  }
  if (!url) return { url: null, name: null };
  const rawName = imgElement?.attrs.file || url.split("/").pop().split("?")[0] || "image.jpg";
  const name2 = rawName.replace(/[\r\n"']+/g, "");
  if (session.app.config.debug) {
    logger3.info(`[Debug] Parsed image URL from elements: ${url}`);
  }
  return { url, name: name2 };
}
__name(getImageUrlAndName, "getImageUrlAndName");

// src/searchers/iqdb.ts
var logger4 = new import_koishi5.Logger("sauce-aggregator");
function fixedHref(href) {
  if (!href) return "";
  if (href.startsWith("//")) {
    return "https:" + href;
  } else if (href.startsWith("/")) {
    return "https://iqdb.org" + href;
  }
  return href;
}
__name(fixedHref, "fixedHref");
function parseImageProperties(alt) {
  if (!alt) return { score: void 0, tags: void 0 };
  const parts = alt.split(" ");
  const properties = {};
  let currentKey = "";
  for (const part of parts) {
    if (part.endsWith(":")) {
      currentKey = part.slice(0, -1).toLowerCase();
      continue;
    }
    if (currentKey) {
      const value = properties[currentKey];
      if (value) {
        if (Array.isArray(value)) {
          value.push(part);
        } else {
          properties[currentKey] = [value, part];
        }
      } else {
        properties[currentKey] = part;
      }
    }
  }
  const tags = properties.tags;
  let finalTags;
  if (tags) {
    finalTags = (Array.isArray(tags) ? tags : [tags]).join(" ").split(",").map((t) => t.trim()).filter(Boolean);
  }
  return {
    score: properties.score ? parseInt(properties.score) : void 0,
    tags: finalTags
  };
}
__name(parseImageProperties, "parseImageProperties");
var IQDB = class {
  constructor(ctx, config, debugConfig, requestTimeout) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.timeout = requestTimeout * 1e3;
  }
  static {
    __name(this, "IQDB");
  }
  name = "iqdb";
  timeout;
  async search(options) {
    const form = new FormData();
    const safeBuffer = Buffer.from(options.imageBuffer);
    form.append("file", new Blob([safeBuffer]), options.fileName);
    const url = "https://iqdb.org/";
    if (this.debugConfig.enabled) logger4.info(`[iqdb] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`);
    try {
      const html = await this.ctx.http.post(url, form, {
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": "https://iqdb.org/"
        },
        timeout: this.timeout
      });
      if (this.debugConfig.enabled) logger4.info(`[iqdb] 收到响应页面，长度: ${html.length}`);
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger4.info(`[iqdb] Raw HTML: ${html.substring(0, 2e3)}...`);
      }
      if (html.includes("File is too large")) throw new Error("图片体积过大 (超过 8MB 限制)。");
      if (html.includes("You are searching too much.")) throw new Error("搜索过于频繁，请稍后再试。");
      const $ = cheerio.load(html);
      const results = [];
      const resultElements = $("#pages > div, #more1 > .pages > div");
      if (resultElements.length === 0) {
        if (html.includes("No relevant results found")) return [];
        if (this.debugConfig.enabled) {
          logger4.warn("[iqdb] 页面结构可能已更改，未找到结果容器。");
          logger4.info(`[iqdb] Raw HTML for debugging:
${html}`);
        }
        return [];
      }
      resultElements.each((_, element) => {
        try {
          const $div = $(element);
          if ($div.find("th").length === 0) return;
          const similarityMatch = $div.find("tr:last-child td").text().match(/(\d+\.?\d*)% similarity/);
          if (!similarityMatch) return;
          const mainUrl = $div.find("td.image a").attr("href");
          if (!mainUrl) return;
          const details = [];
          const $rows = $div.find("table tr");
          const matchType = $rows.eq(0).find("th").text();
          if (matchType) details.push(`匹配类型: ${matchType}`);
          const sizeAndRatingText = $rows.eq(3).find("td").text();
          const dimensionMatch = /(\d+[x×]\d+)/.exec(sizeAndRatingText);
          if (dimensionMatch) details.push(`尺寸: ${dimensionMatch[1]}`);
          const typeMatch = /\[(Safe|Ero|Explicit|Questionable)\]/i.exec(sizeAndRatingText);
          if (typeMatch) details.push(`分级: ${typeMatch[1]}`);
          const altText = $div.find(".image img").attr("alt") || "";
          const props = parseImageProperties(altText);
          if (props.score) details.push(`评分: ${props.score}`);
          if (props.tags && props.tags.length > 0) {
            details.push(`标签: ${props.tags.join(" ")}`);
          }
          const $sourceCell = $rows.eq(2).find("td");
          const primarySource = $sourceCell.clone().children().remove().end().text().trim();
          $sourceCell.find("a").each((_2, el) => {
            const $a = $(el);
            details.push(`${$a.text()} 来源: ${fixedHref($a.attr("href"))}`);
          });
          results.push({
            thumbnail: fixedHref($div.find(".image img").attr("src")),
            similarity: parseFloat(similarityMatch[1]),
            url: fixedHref(mainUrl),
            source: primarySource || "未知来源",
            details
          });
        } catch (parseError) {
          if (this.debugConfig.enabled) logger4.error("[iqdb] 解析单个结果时出错:", parseError);
        }
      });
      return results.filter((r) => r.thumbnail && r.url);
    } catch (error) {
      logger4.warn(`[iqdb] 请求出错: ${error.message}`);
      if (this.debugConfig.enabled && error.response) {
        logger4.debug(`[iqdb] 响应状态: ${error.response.status}`);
        logger4.debug(`[iqdb] 响应数据: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
};

// src/searchers/yandex.ts
var import_koishi6 = require("koishi");
var cheerio2 = __toESM(require("cheerio"));
var import_fs = require("fs");
var import_path = __toESM(require("path"));
var logger5 = new import_koishi6.Logger("sauce-aggregator");
var Yandex = class {
  constructor(ctx, config, debugConfig, puppeteerManager) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.puppeteer = puppeteerManager;
  }
  static {
    __name(this, "Yandex");
  }
  name = "yandex";
  puppeteer;
  async search(options) {
    const page = await this.puppeteer.getPage();
    const tempFilePath = import_path.default.resolve(this.ctx.baseDir, "temp", `sauce-aggregator-yandex-${Date.now()}-${options.fileName}`);
    try {
      const url = `https://${this.config.domain}/images/`;
      if (this.debugConfig.enabled) logger5.info(`[yandex] [Stealth] 导航到: ${url}`);
      await page.goto(url);
      const inputSelector = 'input[type="file"]';
      await page.waitForSelector(inputSelector);
      const inputUploadHandle = await page.$(inputSelector);
      await import_fs.promises.mkdir(import_path.default.dirname(tempFilePath), { recursive: true });
      await import_fs.promises.writeFile(tempFilePath, options.imageBuffer);
      if (this.debugConfig.enabled) logger5.info(`[yandex] [Stealth] 正在上传临时文件: ${tempFilePath}`);
      await inputUploadHandle.uploadFile(tempFilePath);
      if (this.debugConfig.enabled) logger5.info(`[yandex] [Stealth] 等待页面跳转...`);
      await page.waitForNavigation({ waitUntil: "networkidle0" });
      if (this.debugConfig.enabled) logger5.info(`[yandex] [Stealth] 正在解析结果页面: ${page.url()}`);
      const html = await page.content();
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger5.info(`[yandex] Raw HTML length: ${html.length}.`);
      }
      const $ = cheerio2.load(html);
      const dataStateAttr = $('div.Root[id^="ImagesApp-"]').attr("data-state");
      if (!dataStateAttr) {
        if (this.debugConfig.enabled) logger5.warn("[yandex] 页面结构可能已更改，未找到 data-state 属性。");
        return [];
      }
      const dataState = JSON.parse(dataStateAttr);
      const sites = dataState?.initialState?.cbirSites?.sites || [];
      const results = sites.map((site) => {
        const thumbUrl = site.thumb.url;
        const fullThumbUrl = thumbUrl.startsWith("//") ? `https:${thumbUrl}` : thumbUrl;
        return {
          thumbnail: fullThumbUrl,
          similarity: 0,
          url: site.url,
          source: site.domain,
          details: [
            `标题: ${site.title}`,
            `尺寸: ${site.originalImage.width}x${site.originalImage.height}`
          ].filter(Boolean)
        };
      });
      if (this.debugConfig.enabled) logger5.info(`[yandex] 成功解析到 ${results.length} 个结果。`);
      return results;
    } catch (error) {
      logger5.warn(`[yandex] 请求或解析出错: ${error.message}`);
      if (this.debugConfig.enabled) logger5.debug(`[yandex] 错误详情:`, error);
      throw new Error(`请求 Yandex 失败: ${error.message}`);
    } finally {
      if (page && !page.isClosed()) await page.close();
      try {
        await import_fs.promises.unlink(tempFilePath);
      } catch {
      }
    }
  }
};

// src/searchers/ascii2d.ts
var import_koishi7 = require("koishi");
var logger6 = new import_koishi7.Logger("sauce-aggregator");
var Ascii2D = class {
  constructor(ctx, config, debugConfig, puppeteerManager) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.puppeteer = puppeteerManager;
  }
  static {
    __name(this, "Ascii2D");
  }
  name = "ascii2d";
  puppeteer;
  async search(options) {
    if (!options.imageUrl) {
      logger6.warn("[ascii2d] 此引擎需要图片 URL 才能进行搜索。");
      return [];
    }
    const page = await this.puppeteer.getPage();
    try {
      if (this.debugConfig.enabled) logger6.info(`[ascii2d] [Stealth] 导航到 ascii2d.net`);
      await page.goto("https://ascii2d.net/");
      const urlFormSelector = 'form[action="/search/uri"]';
      await page.waitForSelector(urlFormSelector);
      const inputSelector = `${urlFormSelector} input[name="uri"]`;
      if (this.debugConfig.enabled) logger6.info(`[ascii2d] [Stealth] 正在快速输入 URL...`);
      await page.evaluate((selector, value) => {
        const input = document.querySelector(selector);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, inputSelector, options.imageUrl);
      const searchButtonSelector = `${urlFormSelector} button[type="submit"]`;
      await page.waitForSelector(searchButtonSelector);
      if (this.debugConfig.enabled) logger6.info(`[ascii2d] [Stealth] 点击 URL 搜索按钮...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {
        }),
        page.click(searchButtonSelector)
      ]);
      await page.waitForSelector("div.item-box");
      if (this.debugConfig.enabled) logger6.info(`[ascii2d] [Stealth] 已加载颜色搜索 (color) 结果页: ${page.url()}`);
      if (this.debugConfig.enabled) logger6.info(`[ascii2d] [Stealth] 正在解析最终结果页面...`);
      const results = await this.parseResults(page);
      return results.slice(0, options.maxResults);
    } catch (error) {
      logger6.error("[ascii2d] [Stealth] 搜索过程中发生错误:", error);
      if (this.debugConfig.enabled) {
        await this.puppeteer.saveErrorSnapshot(page, this.name);
      }
      throw error;
    } finally {
      if (page && !page.isClosed()) await page.close();
    }
  }
  async parseResults(page) {
    const rawResults = await page.$$eval("div.item-box", (boxes) => {
      return boxes.slice(1).map((box) => {
        if (box.querySelector("h5")?.textContent === "広告") return null;
        const thumbnailElement = box.querySelector("img");
        const detailBox = box.querySelector(".detail-box");
        if (!thumbnailElement || !detailBox) return null;
        const links = Array.from(detailBox.querySelectorAll("h6 a"));
        if (links.length === 0) return null;
        const sourceInfoElement = detailBox.querySelector("h6 small.text-muted");
        const sourceInfo = sourceInfoElement ? sourceInfoElement.textContent : "未知来源";
        const authorLink = links.find((a) => a.href.includes("/users/") || a.href.includes("/i/user/"));
        const mainLink = links.find((a) => !a.href.includes("/users/") && !a.href.includes("/i/user/"));
        const searchTypeElement = box.closest(".row")?.previousElementSibling;
        let searchType = "未知";
        if (searchTypeElement && searchTypeElement.tagName === "H5") {
          searchType = searchTypeElement.textContent || "未知";
        } else {
          const outerTitle = document.querySelector("h5");
          if (outerTitle) {
            searchType = outerTitle.textContent;
          }
        }
        return {
          thumbnail: new URL(thumbnailElement.src, location.origin).href,
          url: mainLink?.href || null,
          source: `[${sourceInfo}] ${mainLink?.textContent || ""}`.trim(),
          author: authorLink?.textContent || null,
          searchType: searchType.trim()
        };
      }).filter(Boolean);
    });
    return rawResults.map((res) => ({
      thumbnail: res.thumbnail,
      similarity: 0,
      url: res.url,
      source: res.source,
      author: res.author,
      details: [`搜索类型: ${res.searchType}`]
    }));
  }
};

// src/searchers/soutubot.ts
var import_koishi8 = require("koishi");
var import_fs2 = require("fs");
var import_path2 = __toESM(require("path"));
var logger7 = new import_koishi8.Logger("sauce-aggregator");
var SoutuBot = class {
  constructor(ctx, config, debugConfig, puppeteerManager) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.puppeteer = puppeteerManager;
  }
  static {
    __name(this, "SoutuBot");
  }
  name = "soutubot";
  puppeteer;
  async search(options) {
    const page = await this.puppeteer.getPage();
    const tempFilePath = import_path2.default.resolve(this.ctx.baseDir, "temp", `sauce-aggregator-soutubot-${Date.now()}-${options.fileName}`);
    try {
      const url = `https://soutubot.moe/`;
      if (this.debugConfig.enabled) logger7.info(`[soutubot] [Stealth] 导航到: ${url}`);
      await page.goto(url, { waitUntil: "networkidle0" });
      const inputSelector = 'input[type="file"]';
      await page.waitForSelector(inputSelector);
      const inputUploadHandle = await page.$(inputSelector);
      await import_fs2.promises.mkdir(import_path2.default.dirname(tempFilePath), { recursive: true });
      await import_fs2.promises.writeFile(tempFilePath, options.imageBuffer);
      if (this.debugConfig.enabled) logger7.info(`[soutubot] [Stealth] 正在上传临时文件: ${tempFilePath}`);
      await inputUploadHandle.uploadFile(tempFilePath);
      const firstResultSelector = "div.card-2";
      const lowConfidenceButtonSelector = "button.el-button--warning";
      const resultsInfoSelector = "div.text-center > h3";
      if (this.debugConfig.enabled) logger7.info(`[soutubot] [Stealth] 等待搜索结果加载 (等待 '${firstResultSelector}' 或 '${resultsInfoSelector}')...`);
      await Promise.race([
        page.waitForSelector(firstResultSelector),
        page.waitForSelector(resultsInfoSelector)
      ]);
      const hasResultCards = await page.$(firstResultSelector);
      const lowConfidenceButton = await page.$(lowConfidenceButtonSelector);
      if (!hasResultCards && lowConfidenceButton) {
        if (this.debugConfig.enabled) logger7.info("[soutubot] 未直接显示结果，正在点击“显示剩余低匹配度结果”按钮...");
        await page.click(lowConfidenceButtonSelector);
        await page.waitForSelector(firstResultSelector);
      } else if (!hasResultCards) {
        if (this.debugConfig.enabled) logger7.info("[soutubot] 页面已加载，但未找到任何结果卡片。");
        return [];
      }
      if (this.debugConfig.enabled) logger7.info(`[soutubot] [Stealth] 正在解析结果页面: ${page.url()}`);
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        const html = await page.content();
        logger7.info(`[soutubot] Raw HTML length: ${html.length}.`);
      }
      const results = await this.parseResults(page);
      return results;
    } catch (error) {
      logger7.error(`[soutubot] [Stealth] 搜索过程中发生错误:`, error);
      if (this.debugConfig.enabled) {
        await this.puppeteer.saveErrorSnapshot(page, this.name);
      }
      if (error.name === "TimeoutError") {
        throw new Error(`等待搜索结果超时，网站可能没有响应或没有找到结果。`);
      }
      throw error;
    } finally {
      if (page && !page.isClosed()) await page.close();
      try {
        await import_fs2.promises.unlink(tempFilePath);
      } catch {
      }
    }
  }
  async parseResults(page) {
    const highConfidenceResultsSelector = "div.grid.grid-cols-1.gap-4:not(.mt-4) div.card-2";
    const rawResults = await page.$$eval(highConfidenceResultsSelector, (cards) => {
      const langMap = { cn: "中文", jp: "日文", gb: "英文", kr: "韩文" };
      return cards.map((card) => {
        const similarityEl = Array.from(card.querySelectorAll("span")).find((el) => el.textContent.trim() === "匹配度:");
        const similarityText = similarityEl ? similarityEl.nextElementSibling?.textContent.trim().replace("%", "") : "0";
        const title = card.querySelector(".font-semibold span")?.innerText;
        const thumbnail = card.querySelector('a[target="_blank"] img')?.src;
        const sourceImg = card.querySelector('img[src*="/images/icons/"]');
        const sourceName = sourceImg ? sourceImg.src.split("/").pop().replace(".png", "") : "未知";
        const langFlag = card.querySelector('span.fi[class*="fi-"]');
        const langCode = langFlag ? Array.from(langFlag.classList).find((c) => c.startsWith("fi-")).replace("fi-", "") : null;
        const language = langMap[langCode] || langCode;
        const detailPageLink = Array.from(card.querySelectorAll("a.el-button")).find((a) => a.textContent.includes("详情页"));
        const imagePageLink = Array.from(card.querySelectorAll("a.el-button")).find((a) => a.textContent.includes("图片页"));
        return {
          thumbnail,
          similarity: parseFloat(similarityText),
          title,
          sourceName,
          language,
          detailUrl: detailPageLink?.href,
          imageUrl: imagePageLink?.href,
          imagePageText: imagePageLink?.innerText.trim()
        };
      }).filter(Boolean);
    });
    return rawResults.map((res) => {
      const details = [];
      if (res.language) details.push(`语言: ${res.language}`);
      if (res.imageUrl) details.push(`${res.imagePageText}: ${res.imageUrl}`);
      return {
        thumbnail: res.thumbnail,
        similarity: res.similarity,
        url: res.detailUrl || res.imageUrl,
        source: `[${res.sourceName}] ${res.title || "未知作品"}`,
        details
      };
    });
  }
};

// src/index.ts
var import_buffer2 = require("buffer");

// src/enhancers/yande.ts
var import_koishi9 = require("koishi");
var logger8 = new import_koishi9.Logger("sauce-aggregator");
var YandeReEnhancer = class {
  constructor(ctx, config, debugConfig, requestTimeout) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.timeout = requestTimeout * 1e3;
  }
  static {
    __name(this, "YandeReEnhancer");
  }
  name = "yandere";
  timeout;
  async enhance(result) {
    const yandeReUrl = this.findYandeReUrl(result);
    if (!yandeReUrl) return null;
    const postId = this.parsePostId(yandeReUrl);
    if (!postId) return null;
    if (this.debugConfig.enabled) logger8.info(`[yande.re] 检测到 Yande.re 链接，帖子 ID: ${postId}，开始获取图源信息...`);
    try {
      const apiUrl = `https://yande.re/post.json?tags=id:${postId}`;
      const response = await this.ctx.http.get(apiUrl, { timeout: this.timeout });
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger8.info(`[yande.re] API 响应: ${JSON.stringify(response, null, 2)}`);
      }
      if (!response || response.length === 0) {
        if (this.debugConfig.enabled) logger8.warn(`[yande.re] API 未能找到 ID 为 ${postId} 的帖子。`);
        return null;
      }
      const post = response[0];
      const ratingHierarchy = { s: 1, q: 2, e: 3 };
      const postRatingLevel = ratingHierarchy[post.rating];
      const maxAllowedLevel = ratingHierarchy[this.config.maxRating];
      if (postRatingLevel > maxAllowedLevel) {
        if (this.debugConfig.enabled) logger8.info(`[yande.re] 帖子 ${postId} 的评级为 '${post.rating.toUpperCase()}'，超出了配置允许的最高等级 '${this.config.maxRating.toUpperCase()}'，已跳过。`);
        return { details: [import_koishi9.h.text(`[!] Yande.re 图源的评级 (${post.rating.toUpperCase()}) 超出设置，已隐藏详情。`)] };
      }
      const details = this.buildDetailNodes(post);
      let downloadUrl;
      switch (this.config.postQuality) {
        case "original":
          downloadUrl = post.file_url;
          break;
        case "sample":
          downloadUrl = post.sample_url;
          break;
        case "jpeg":
        default:
          downloadUrl = post.jpeg_url;
          break;
      }
      if (this.debugConfig.enabled) logger8.info(`[yande.re] 正在下载图源图片 (${this.config.postQuality} 质量)... URL: ${downloadUrl}`);
      const imageBuffer = Buffer.from(await this.ctx.http.get(downloadUrl, { responseType: "arraybuffer", timeout: this.timeout }));
      const imageType = getImageTypeFromUrl(downloadUrl);
      return { details, imageBuffer, imageType };
    } catch (error) {
      logger8.error(`[yande.re] 获取图源信息 (ID: ${postId}) 时发生错误:`, error);
      return null;
    }
  }
  findYandeReUrl(result) {
    const urlRegex = /(https?:\/\/yande\.re\/post\/show\/\d+)/;
    if (result.url && urlRegex.test(result.url)) {
      return result.url;
    }
    if (result.details) {
      for (const detail of result.details) {
        const match = detail.match(urlRegex);
        if (match) return match[0];
      }
    }
    return null;
  }
  parsePostId(url) {
    const match = url.match(/yande\.re\/post\/show\/(\d+)/);
    return match ? match[1] : null;
  }
  buildDetailNodes(post) {
    const info = [];
    info.push(`Yande.re (ID: ${post.id})`);
    info.push(`尺寸: ${post.width}x${post.height}`);
    info.push(`评分: ${post.score}`);
    info.push(`等级: ${post.rating.toUpperCase()}`);
    info.push(`上传者: ${post.author}`);
    const postDate = new Date(post.updated_at * 1e3).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    info.push(`更新于: ${postDate}`);
    if (post.source && post.source.startsWith("http")) {
      info.push(`原始来源: ${post.source}`);
    }
    const tags = post.tags.split(" ").map((tag) => tag.replace(/_/g, " ")).filter(Boolean);
    const displayedTags = tags.slice(0, 15).join(", ");
    const remainingCount = tags.length - 15;
    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);
    return [import_koishi9.h.text(info.join("\n"))];
  }
};

// src/enhancers/gelbooru.ts
var import_koishi10 = require("koishi");
var logger9 = new import_koishi10.Logger("sauce-aggregator");
var GelbooruEnhancer = class {
  constructor(ctx, config, debugConfig, requestTimeout) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.timeout = requestTimeout * 1e3;
  }
  static {
    __name(this, "GelbooruEnhancer");
  }
  name = "gelbooru";
  timeout;
  async enhance(result) {
    const gelbooruUrl = this.findGelbooruUrl(result);
    if (!gelbooruUrl) return null;
    const postId = this.parseParam(gelbooruUrl, "id");
    const postMd5 = this.parseParam(gelbooruUrl, "md5");
    if (!postId && !postMd5) {
      if (this.debugConfig.enabled) logger9.info(`[gelbooru] 在链接 ${gelbooruUrl} 中未找到有效的 id 或 md5 参数。`);
      return null;
    }
    const logIdentifier = postId ? `ID: ${postId}` : `MD5: ${postMd5}`;
    if (this.debugConfig.enabled) logger9.info(`[gelbooru] 检测到 Gelbooru 链接，${logIdentifier}，开始获取图源信息...`);
    try {
      const keyPair = this.config.keyPairs[Math.floor(Math.random() * this.config.keyPairs.length)];
      const apiUrl = "https://gelbooru.com/index.php";
      const apiParams = {
        page: "dapi",
        s: "post",
        q: "index",
        json: "1",
        api_key: keyPair.apiKey,
        user_id: keyPair.userId
      };
      if (postId) {
        apiParams.id = postId;
      } else {
        apiParams.tags = `md5:${postMd5}`;
      }
      const response = await this.ctx.http.get(apiUrl, {
        headers: {
          "User-Agent": USER_AGENT
        },
        params: apiParams,
        timeout: this.timeout
      });
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger9.info(`[gelbooru] API 响应: ${JSON.stringify(response, null, 2)}`);
      }
      const post = response?.post?.[0];
      if (!post || !post.id) {
        if (this.debugConfig.enabled) logger9.warn(`[gelbooru] API 未能找到帖子 (${logIdentifier})。`);
        return null;
      }
      const ratingHierarchy = { general: 1, sensitive: 2, questionable: 3, explicit: 4 };
      const postRatingLevel = ratingHierarchy[post.rating];
      const maxAllowedLevel = ratingHierarchy[this.config.maxRating];
      if (postRatingLevel > maxAllowedLevel) {
        if (this.debugConfig.enabled) logger9.info(`[gelbooru] 帖子 ${post.id} 的评级 '${post.rating}' 超出设置 '${this.config.maxRating}'，已跳过。`);
        return { details: [import_koishi10.h.text(`[!] Gelbooru 图源的评级 (${post.rating}) 超出设置，已隐藏详情。`)] };
      }
      const details = this.buildDetailNodes(post);
      let downloadUrl;
      switch (this.config.postQuality) {
        case "original":
          downloadUrl = post.file_url;
          break;
        case "sample":
          downloadUrl = post.sample_url;
          break;
        case "preview":
          downloadUrl = post.preview_url;
          break;
        default:
          downloadUrl = post.sample_url;
          break;
      }
      if (!downloadUrl) {
        if (this.debugConfig.enabled) logger9.warn(`[gelbooru] 帖子 ${post.id} 缺少 ${this.config.postQuality} 质量的图片URL，将尝试使用 sample_url。`);
        downloadUrl = post.sample_url;
      }
      if (!downloadUrl) {
        if (this.debugConfig.enabled) logger9.warn(`[gelbooru] 帖子 ${post.id} 缺少任何可用的图片URL。`);
        return { details };
      }
      if (this.debugConfig.enabled) logger9.info(`[gelbooru] 正在下载图源图片 (${this.config.postQuality} 质量)... URL: ${downloadUrl}`);
      const imageBuffer = Buffer.from(await this.ctx.http.get(downloadUrl, { responseType: "arraybuffer", timeout: this.timeout }));
      const imageType = getImageTypeFromUrl(downloadUrl);
      return { details, imageBuffer, imageType };
    } catch (error) {
      logger9.error(`[gelbooru] 获取图源信息 (${logIdentifier}) 时发生错误:`, error);
      return null;
    }
  }
  findGelbooruUrl(result) {
    const urlRegex = /(https?:\/\/gelbooru\.com\/index\.php\?[^"\s]*(id=\d+|md5=[a-f0-f0-9]{32}))/;
    if (result.url && urlRegex.test(result.url)) return result.url;
    if (result.details) {
      for (const detail of result.details) {
        const match = detail.match(urlRegex);
        if (match) return match[0];
      }
    }
    return null;
  }
  parseParam(url, param) {
    const match = url.match(new RegExp(`[?&]${param}=([^&]*)`));
    return match ? match[1] : null;
  }
  buildDetailNodes(post) {
    const info = [];
    info.push(`Gelbooru (ID: ${post.id})`);
    info.push(`尺寸: ${post.width}x${post.height}`);
    info.push(`评分: ${post.score}`);
    info.push(`等级: ${post.rating}`);
    info.push(`上传者: ${post.owner.replace(/_/g, " ")}`);
    const postDate = new Date(post.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    info.push(`发布于: ${postDate}`);
    if (post.source && post.source.startsWith("http")) {
      info.push(`原始来源: ${post.source}`);
    }
    const tags = post.tags.split(" ").map((tag) => tag.replace(/_/g, " ")).filter(Boolean);
    const displayedTags = tags.slice(0, 15).join(", ");
    const remainingCount = tags.length - 15;
    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);
    return [import_koishi10.h.text(info.join("\n"))];
  }
};

// src/enhancers/danbooru.ts
var import_koishi11 = require("koishi");
var logger10 = new import_koishi11.Logger("sauce-aggregator");
var DanbooruEnhancer = class {
  constructor(ctx, config, debugConfig, puppeteerManager) {
    this.ctx = ctx;
    this.config = config;
    this.debugConfig = debugConfig;
    this.puppeteer = puppeteerManager;
  }
  static {
    __name(this, "DanbooruEnhancer");
  }
  name = "danbooru";
  puppeteer;
  async enhance(result) {
    const danbooruUrl = this.findDanbooruUrl(result);
    if (!danbooruUrl) return null;
    const postId = this.parsePostId(danbooruUrl);
    if (!postId) {
      if (this.debugConfig.enabled) logger10.info(`[danbooru] 在链接 ${danbooruUrl} 中未找到有效的帖子 ID。`);
      return null;
    }
    const page = await this.puppeteer.getPage();
    try {
      let post;
      let imageBuffer;
      const keyPair = this.config.keyPairs[Math.floor(Math.random() * this.config.keyPairs.length)];
      const apiBaseUrl = `https://danbooru.donmai.us/posts/${postId}.json`;
      const apiUrl = `${apiBaseUrl}?login=${keyPair.username}&api_key=${keyPair.apiKey}`;
      if (this.debugConfig.enabled) logger10.info(`[danbooru] [Stealth] 正在通过 fetch 获取 API: ${apiBaseUrl}`);
      await page.goto("https://danbooru.donmai.us/posts");
      const jsonContent = await page.evaluate(
        (url) => fetch(url).then((res) => {
          if (!res.ok) throw new Error(`API Request failed with status ${res.status}`);
          return res.text();
        }),
        apiUrl
      );
      post = JSON.parse(jsonContent);
      if (this.debugConfig.logApiResponses.includes(this.name)) {
        logger10.info(`[danbooru] API 响应: ${JSON.stringify(post, null, 2)}`);
      }
      if (post.success === false) throw new Error(`API returned an error: ${post.message || "Authentication failed"}`);
      if (!post.id) throw new Error(`API did not return a valid post object.`);
      let downloadUrl;
      switch (this.config.postQuality) {
        case "original":
          downloadUrl = post.file_url;
          break;
        case "sample":
          downloadUrl = post.large_file_url;
          break;
        case "preview":
          downloadUrl = post.preview_file_url;
          break;
        default:
          downloadUrl = post.large_file_url;
          break;
      }
      if (downloadUrl) {
        if (this.debugConfig.enabled) logger10.info(`[danbooru] [Stealth] 正在下载图源图片: ${downloadUrl}`);
        await page.setExtraHTTPHeaders({
          "Referer": `https://danbooru.donmai.us/posts/${postId}`
        });
        const imageResponse = await page.goto(downloadUrl);
        if (!imageResponse.ok()) {
          throw new Error(`Image download failed with status ${imageResponse.status()}`);
        }
        imageBuffer = await imageResponse.buffer();
        if (this.debugConfig.enabled) logger10.info(`[danbooru] [Stealth] 图片下载成功，大小: ${imageBuffer.length} 字节。`);
      }
      const ratingMap = { g: "general", s: "sensitive", q: "questionable", e: "explicit" };
      const ratingHierarchy = { general: 1, sensitive: 2, questionable: 3, explicit: 4 };
      const postRating = ratingMap[post.rating];
      const postRatingLevel = ratingHierarchy[postRating];
      const maxAllowedLevel = ratingHierarchy[this.config.maxRating];
      if (postRatingLevel > maxAllowedLevel) {
        if (this.debugConfig.enabled) logger10.info(`[danbooru] 帖子 ${post.id} 的评级 '${postRating}' 超出设置 '${this.config.maxRating}'，已跳过。`);
        return { details: [import_koishi11.h.text(`[!] Danbooru 图源的评级 (${postRating}) 超出设置，已隐藏详情。`)] };
      }
      const details = this.buildDetailNodes(post);
      const imageType = getImageTypeFromUrl(post.file_url);
      return { details, imageBuffer, imageType };
    } catch (error) {
      logger10.error(`[danbooru] [Stealth] 处理过程中发生错误 (ID: ${postId}):`, error);
      throw error;
    } finally {
      if (page && !page.isClosed()) await page.close();
    }
  }
  findDanbooruUrl(result) {
    const urlRegex = /(https?:\/\/danbooru\.donmai\.us\/(posts|post\/show)\/\d+)/;
    if (result.url && urlRegex.test(result.url)) return result.url;
    if (result.details) {
      for (const detail of result.details) {
        const match = detail.match(urlRegex);
        if (match) return match[0];
      }
    }
    return null;
  }
  parsePostId(url) {
    const match = url.match(/(\d+)/g);
    return match ? match[match.length - 1] : null;
  }
  buildDetailNodes(post) {
    const info = [];
    const formatTags = /* @__PURE__ */ __name((tagString) => tagString.split(" ").map((tag) => tag.replace(/_/g, " ")).filter(Boolean).join(", "), "formatTags");
    info.push(`Danbooru (ID: ${post.id})`);
    const artists = formatTags(post.tag_string_artist);
    if (artists) info.push(`作者: ${artists}`);
    const copyrights = formatTags(post.tag_string_copyright);
    if (copyrights) info.push(`作品: ${copyrights}`);
    const characters = formatTags(post.tag_string_character);
    if (characters) info.push(`角色: ${characters}`);
    info.push(`评分: ${post.score} (收藏: ${post.fav_count})`);
    info.push(`等级: ${post.rating.toUpperCase()}`);
    const postDate = new Date(post.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    info.push(`发布于: ${postDate}`);
    const fileSizeMB = (post.file_size / 1024 / 1024).toFixed(2);
    info.push(`文件信息: ${post.image_width}x${post.image_height} (${fileSizeMB} MB, ${post.file_ext})`);
    if (post.source && post.source.startsWith("http")) {
      info.push(`原始来源: ${post.source}`);
    }
    const allTags = post.tag_string_general.split(" ").map((tag) => tag.replace(/_/g, " ")).filter(Boolean);
    const displayedTags = allTags.slice(0, 25).join(", ");
    const remainingCount = allTags.length - 25;
    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);
    return [import_koishi11.h.text(info.join("\n"))];
  }
};

// src/puppeteer.ts
var import_koishi12 = require("koishi");
var import_puppeteer_extra = __toESM(require("puppeteer-extra"));
var import_puppeteer_extra_plugin_stealth = __toESM(require("puppeteer-extra-plugin-stealth"));
var import_puppeteer_finder = __toESM(require("puppeteer-finder"));
var import_fs3 = require("fs");
var import_path3 = __toESM(require("path"));
var logger11 = new import_koishi12.Logger("sauce-aggregator:puppeteer");
import_puppeteer_extra.default.use((0, import_puppeteer_extra_plugin_stealth.default)());
var PuppeteerManager = class {
  static {
    __name(this, "PuppeteerManager");
  }
  _browserPromise = null;
  ctx;
  config;
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
  }
  async getBrowserPath() {
    if (this.config.chromeExecutablePath) {
      if (this.config.debug.enabled) logger11.info(`[Stealth] 使用用户配置的全局浏览器路径: ${this.config.chromeExecutablePath}`);
      return this.config.chromeExecutablePath;
    }
    try {
      if (this.config.debug.enabled) logger11.info("[Stealth] 正在使用 puppeteer-finder 自动检测浏览器...");
      const browserPath = await (0, import_puppeteer_finder.default)();
      logger11.info(`[Stealth] 自动检测到浏览器路径: ${browserPath}`);
      return browserPath;
    } catch (error) {
      logger11.warn("[Stealth] puppeteer-finder 未能找到任何浏览器:", error);
      return null;
    }
  }
  async launchBrowser() {
    const executablePath = await this.getBrowserPath();
    if (!executablePath) {
      throw new Error("未能找到任何兼容的浏览器。请在插件的基础设置中手动指定路径。");
    }
    const timeout = this.config.requestTimeout * 1e3;
    const browser = await import_puppeteer_extra.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        `--user-agent=${USER_AGENT}`
      ],
      executablePath,
      protocolTimeout: timeout * 2,
      timeout
    });
    browser.on("disconnected", () => {
      logger11.warn("[Stealth] 共享浏览器实例已断开连接。");
      this._browserPromise = null;
    });
    return browser;
  }
  getBrowser() {
    if (this._browserPromise) {
      return this._browserPromise.then((browser) => {
        if (browser.isConnected()) {
          return browser;
        }
        if (this.config.debug.enabled) logger11.info("[Stealth] 共享浏览器实例已断开，正在启动新的实例...");
        this._browserPromise = this.launchBrowser().catch((err) => {
          this._browserPromise = null;
          throw err;
        });
        return this._browserPromise;
      });
    }
    if (this.config.debug.enabled) logger11.info("[Stealth] 共享浏览器实例不存在，正在启动...");
    this._browserPromise = this.launchBrowser().catch((err) => {
      this._browserPromise = null;
      throw err;
    });
    return this._browserPromise;
  }
  async getPage() {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(this.config.requestTimeout * 1e3);
    await page.setBypassCSP(true);
    return page;
  }
  async saveErrorSnapshot(page, contextName) {
    try {
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const logDir = import_path3.default.resolve(this.ctx.baseDir, "logs");
      await import_fs3.promises.mkdir(logDir, { recursive: true });
      const screenshotPath = import_path3.default.resolve(logDir, `${contextName}-error-${timestamp}.png`);
      const htmlPath = import_path3.default.resolve(logDir, `${contextName}-error-${timestamp}.html`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const htmlContent = await page.content();
      await import_fs3.promises.writeFile(htmlPath, htmlContent);
      logger11.info(`[Stealth] [${contextName}] 已保存错误快照: ${screenshotPath}`);
      logger11.info(`[Stealth] [${contextName}] 已保存错误页面HTML: ${htmlPath}`);
    } catch (snapshotError) {
      logger11.error(`[Stealth] [${contextName}] 保存错误快照失败:`, snapshotError);
    }
  }
  async dispose() {
    if (this._browserPromise) {
      try {
        const browser = await this._browserPromise;
        if (browser?.isConnected()) {
          if (this.config.debug.enabled) logger11.info("[Stealth] 正在关闭共享浏览器实例...");
          await browser.close();
        }
      } catch (error) {
        logger11.warn("[Stealth] 关闭浏览器实例时发生错误:", error);
      }
      this._browserPromise = null;
    }
  }
};

// src/core/search-handler.ts
var import_koishi14 = require("koishi");

// src/core/message-builder.ts
var import_koishi13 = require("koishi");
var logger12 = new import_koishi13.Logger("sauce-aggregator:message-builder");
async function createResultContent(ctx, result, engineName) {
  const textFields = [
    // *** THIS IS THE FIX ***
    // Add engine name to the message body if provided.
    engineName ? `引擎: ${engineName}` : null,
    result.similarity ? `相似度: ${result.similarity.toFixed(2)}%` : null,
    result.source ? `来源: ${result.source}` : null,
    result.author ? `作者: ${result.author}` : null,
    result.time ? `时间: ${result.time}` : null,
    ...result.details || [],
    result.url ? `链接: ${result.url}` : null
  ].filter(Boolean);
  const textNode = import_koishi13.h.text("\n" + textFields.join("\n"));
  try {
    const imageBuffer = Buffer.from(await ctx.http.get(result.thumbnail, { responseType: "arraybuffer" }));
    const imageBase64 = imageBuffer.toString("base64");
    const dataUri = `data:image/jpeg;base64,${imageBase64}`;
    return [import_koishi13.h.image(dataUri), textNode];
  } catch (e) {
    logger12.warn(`缩略图下载失败 ${result.thumbnail}:`, e.message);
    return [(0, import_koishi13.h)("p", "[!] 缩略图加载失败"), textNode];
  }
}
__name(createResultContent, "createResultContent");
async function buildLowConfidenceNode(ctx, result, engineName, botUser) {
  const content = await createResultContent(ctx, result, engineName);
  return (0, import_koishi13.h)("message", {
    nickname: (result.source || engineName).substring(0, 10),
    avatar: botUser.avatar
  }, content);
}
__name(buildLowConfidenceNode, "buildLowConfidenceNode");
async function buildHighConfidenceMessage(figureMessage, ctx, config, sortedEnhancers, result, engineName, botUser) {
  if (result.coverImage) {
    figureMessage.children.push((0, import_koishi13.h)("message", { nickname: "番剧封面", avatar: botUser.avatar }, import_koishi13.h.image(result.coverImage)));
  }
  const formattedContent = await createResultContent(ctx, result);
  const detailsNode = (0, import_koishi13.h)("message", { nickname: "详细信息", avatar: botUser.avatar }, formattedContent);
  figureMessage.children.push(detailsNode);
  if (engineName === "tracemoe" && config.tracemoe.sendVideoPreview && result.url) {
    try {
      if (config.debug.enabled) logger12.info(`[tracemoe] 正在为高置信度结果下载视频预览...`);
      const videoPreview = await ctx.http.get(result.url, { responseType: "arraybuffer" });
      figureMessage.children.push((0, import_koishi13.h)("message", { nickname: "视频预览", avatar: botUser.avatar }, import_koishi13.h.video(videoPreview, "video/mp4")));
    } catch (e) {
      logger12.warn(`[tracemoe] 高置信度视频预览下载失败: ${e.message}`);
    }
  }
  for (const enhancer of sortedEnhancers) {
    try {
      const enhancedData = await enhancer.enhance(result);
      if (enhancedData) {
        if (config.debug.enabled) logger12.info(`[${enhancer.name}] 已成功获取图源信息。`);
        if (enhancedData.imageBuffer) {
          figureMessage.children.push((0, import_koishi13.h)("message", { nickname: "图源图片", avatar: botUser.avatar }, import_koishi13.h.image(enhancedData.imageBuffer, enhancedData.imageType)));
        }
        const enhancedDetailsNode = (0, import_koishi13.h)("message", { nickname: "图源信息", avatar: botUser.avatar }, enhancedData.details);
        figureMessage.children.push(enhancedDetailsNode);
        break;
      }
    } catch (e) {
      logger12.warn(`[${enhancer.name}] 图源处理时发生错误:`, e);
    }
  }
}
__name(buildHighConfidenceMessage, "buildHighConfidenceMessage");
async function sendFigureMessage(session, figureMessage, errorMessage) {
  if (figureMessage.children.length > 0) {
    try {
      await session.send(figureMessage);
    } catch (e) {
      logger12.warn(`${errorMessage}:`, e.message);
      await session.send("结果发送失败，请检查适配器兼容性。");
    }
  }
}
__name(sendFigureMessage, "sendFigureMessage");

// src/core/search-handler.ts
var logger13 = new import_koishi14.Logger("sauce-aggregator:handler");
var SearchHandler = class {
  constructor(ctx, config, allSearchers, allEnabledSearchers) {
    this.ctx = ctx;
    this.config = config;
    this.allSearchers = allSearchers;
    this.allEnabledSearchers = allEnabledSearchers;
  }
  static {
    __name(this, "SearchHandler");
  }
  async performSearch(searcher, options) {
    try {
      const results = await searcher.search(options);
      return { engine: searcher.name, results, error: null };
    } catch (error) {
      const errorMessage = `[${searcher.name}] 引擎搜索失败: ${error.message}`;
      logger13.warn(errorMessage, this.config.debug.enabled ? error : "");
      return { engine: searcher.name, results: [], error: errorMessage };
    }
  }
  async handleDirectSearch(searchers, options, botUser, session, collectedErrors) {
    const searcherOutputs = await Promise.all(searchers.map(async (s) => {
      const output = await this.performSearch(s, options);
      if (output.error) collectedErrors.push(output.error);
      return output;
    }));
    const successfulOutputs = searcherOutputs.filter((o) => o.results.length > 0);
    if (successfulOutputs.length === 0) {
      let finalMessage = "未找到任何相关结果。";
      if (collectedErrors.length > 0) {
        finalMessage += "\n\n遇到的问题:\n" + collectedErrors.join("\n");
      }
      return finalMessage;
    }
    await session.send("搜索完成，结果如下:");
    const figureMessage = (0, import_koishi14.h)("figure");
    const nodePromises = successfulOutputs.flatMap((output) => {
      const resultNodesPromises = output.results.slice(0, this.config.maxResults).map(
        (result) => buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
      );
      return resultNodesPromises;
    });
    figureMessage.children.push(...await Promise.all(nodePromises));
    await sendFigureMessage(session, figureMessage, "合并转发结果失败");
    if (collectedErrors.length > 0) {
      await session.send("部分引擎搜索失败:\n" + collectedErrors.join("\n"));
    }
  }
  async handleSequentialSearch(searchers, options, botUser, session, collectedErrors, sortedEnhancers) {
    const executedOutputs = [];
    let highConfidenceResults = [];
    let highConfidenceSearcherName = null;
    const executedEngineNames = /* @__PURE__ */ new Set();
    for (const searcher of searchers) {
      executedEngineNames.add(searcher.name);
      const output = await this.performSearch(searcher, options);
      if (output.error) collectedErrors.push(output.error);
      if (output.results.length > 0) executedOutputs.push(output);
      const engineConfig = this.config[searcher.name];
      const specificThreshold = engineConfig?.confidenceThreshold;
      const thresholdToUse = specificThreshold && specificThreshold > 0 ? specificThreshold : this.config.confidenceThreshold;
      const foundResults = output.results.filter((r) => r.similarity >= thresholdToUse);
      if (foundResults.length > 0) {
        highConfidenceResults = foundResults;
        highConfidenceSearcherName = searcher.name;
        break;
      }
    }
    if (highConfidenceResults.length > 0) {
      let resultsToShow = highConfidenceResults;
      if (highConfidenceSearcherName === "soutubot") {
        const maxCount = this.config.soutubot.maxHighConfidenceResults || 3;
        resultsToShow = highConfidenceResults.slice(0, maxCount);
        await session.send(`[${highConfidenceSearcherName}] 找到 ${resultsToShow.length} 个高匹配度结果:`);
      } else {
        resultsToShow = [highConfidenceResults[0]];
        await session.send(`[${highConfidenceSearcherName}] 找到高匹配度结果:`);
      }
      const figureMessage2 = (0, import_koishi14.h)("figure");
      for (const result of resultsToShow) {
        await buildHighConfidenceMessage(figureMessage2, this.ctx, this.config, sortedEnhancers, result, highConfidenceSearcherName, botUser);
      }
      await this.attachAdditionalResults(executedOutputs, options, botUser, figureMessage2, session, collectedErrors);
      await sendFigureMessage(session, figureMessage2, "发送高匹配度结果失败");
      return;
    }
    let finalOutputs = executedOutputs;
    const searchersToRunForLowConfidence = this.allEnabledSearchers.filter((s) => {
      if (s.name === "yandex") return !this.config.yandex.alwaysAttach;
      if (s.name === "ascii2d") return !this.config.ascii2d.alwaysAttach;
      return true;
    }).filter((s) => !executedEngineNames.has(s.name));
    if (searchersToRunForLowConfidence.length > 0) {
      const unexecutedOutputs = await Promise.all(searchersToRunForLowConfidence.map(async (s) => {
        const output = await this.performSearch(s, options);
        if (output.error) collectedErrors.push(output.error);
        return output;
      }));
      finalOutputs.push(...unexecutedOutputs.filter((o) => o.results.length > 0));
    }
    await this.attachAdditionalResults(finalOutputs, options, botUser, null, session, collectedErrors);
    if (finalOutputs.length === 0) {
      let finalMessage = "未找到任何相关结果。";
      if (collectedErrors.length > 0) {
        finalMessage += "\n\n遇到的问题:\n" + collectedErrors.join("\n");
      }
      return finalMessage;
    }
    await session.send("未找到高匹配度结果，显示如下:");
    const figureMessage = (0, import_koishi14.h)("figure");
    const nodePromises = finalOutputs.flatMap((output) => {
      const resultNodesPromises = output.results.slice(0, this.config.maxResults).map(
        (result) => buildLowConfidenceNode(this.ctx, result, output.engine, botUser)
      );
      return resultNodesPromises;
    });
    figureMessage.children.push(...await Promise.all(nodePromises));
    await sendFigureMessage(session, figureMessage, "合并转发低匹配度结果失败");
    if (collectedErrors.length > 0) {
      await session.send("部分引擎搜索失败:\n" + collectedErrors.join("\n"));
    }
  }
  async attachAdditionalResults(executedOutputs, options, botUser, figureMessage, session, collectedErrors) {
    const attachEngines = [
      { name: "yandex", config: this.config.yandex, searcher: this.allSearchers.yandex },
      { name: "ascii2d", config: this.config.ascii2d, searcher: this.allSearchers.ascii2d }
    ];
    for (const eng of attachEngines) {
      if (eng.config.alwaysAttach && eng.searcher) {
        let output = executedOutputs.find((o) => o.engine === eng.name);
        if (!output) {
          output = await this.performSearch(eng.searcher, options);
          if (output.error) collectedErrors.push(output.error);
        }
        if (output?.results?.[0]) {
          if (figureMessage) {
            const result = output.results[0];
            const headerNode = (0, import_koishi14.h)("message", { nickname: `--- ${eng.name} (附加结果) ---`, avatar: botUser.avatar });
            const resultNode = await buildLowConfidenceNode(this.ctx, result, eng.name, botUser);
            figureMessage.children.push(headerNode, resultNode);
          } else {
            if (!executedOutputs.some((o) => o.engine === eng.name)) {
              executedOutputs.push(output);
            }
          }
        }
      }
    }
  }
};

// src/index.ts
var name = "sauce-aggregator";
var using = ["http"];
var inject = ["http"];
var logger14 = new import_koishi15.Logger(name);
var usage = `
指令: sauce [引擎名] [图片]
别名: 搜图, soutu
选项: --all / -a (返回全部引擎搜索结果)

- **默认搜索**: \`sauce [图片]\` - 按配置顺序搜索，找到高匹配度结果后停止。
- **全量搜索**: \`sauce --all [图片]\` - 搜索所有启用的引擎并报告全部结果。
- **指定引擎搜索**: \`sauce <引擎名> [图片]\` - 只使用指定引擎搜索。

**可用引擎名 (及其别名)**:
- \`saucenao\` (s) : 识别动漫、插画和本子图片等。
- \`iqdb\` (i) : 从多个图源网站识别动漫、漫画、游戏图片和壁纸。
- \`tracemoe\` (t) : 识别番剧截图，提供标题、集数、时间轴与视频预览。
- \`soutubot\` (b) : 搜图bot酱，使用完整图或局部图识别nh和eh本子图片。
- \`ascii2d\` (a) : 二次元画像詳細検索，作为补充结果。
- \`yandex\` (y) : 识别网络媒体和网站中存在的相似图片并返回来源，主要作为其他引擎未找到高匹配度结果时的补充。

###	注意：
####	部分引擎需要配置代理才可用, http相关报错请先检查代理设置。
####	为绕过机器人脚本防护，yandex, ascii2d, danbooru, soutubot搜图使用浏览器实例实现，响应速度相对较慢。
`;
function apply(ctx, config) {
  const puppeteerManager = new PuppeteerManager(ctx, config);
  ctx.on("dispose", () => puppeteerManager.dispose());
  const allSearchers = {};
  if (config.saucenao.apiKeys && config.saucenao.apiKeys.length > 0) {
    allSearchers.saucenao = new SauceNAO(ctx, config.saucenao, config.debug, config.requestTimeout);
  } else {
    logger14.info("[saucenao] 未提供任何 API Key，引擎已禁用。");
  }
  allSearchers.tracemoe = new TraceMoe(ctx, config.tracemoe, config.debug, config.requestTimeout);
  allSearchers.iqdb = new IQDB(ctx, config.iqdb, config.debug, config.requestTimeout);
  allSearchers.yandex = new Yandex(ctx, config.yandex, config.debug, puppeteerManager);
  allSearchers.ascii2d = new Ascii2D(ctx, config.ascii2d, config.debug, puppeteerManager);
  allSearchers.soutubot = new SoutuBot(ctx, config.soutubot, config.debug, puppeteerManager);
  const availableEngines = Object.keys(allSearchers);
  const engineAliases = {
    "s": "saucenao",
    "i": "iqdb",
    "t": "tracemoe",
    "y": "yandex",
    "a": "ascii2d",
    "b": "soutubot"
  };
  const allEnabledSearchers = config.order.filter((item) => item.enabled && allSearchers[item.engine]).map((item) => allSearchers[item.engine]);
  const sequentialSearchers = allEnabledSearchers.filter((searcher) => searcher.name !== "yandex" && searcher.name !== "ascii2d");
  const allEnhancers = {};
  const enhancerRegistry = {
    yandere: { constructor: YandeReEnhancer, needsKeys: false, keys: null, keyName: "", messageName: "图源" },
    gelbooru: { constructor: GelbooruEnhancer, needsKeys: true, keys: config.gelbooru.keyPairs, keyName: "API Key", messageName: "图源" },
    danbooru: { constructor: DanbooruEnhancer, needsKeys: true, keys: config.danbooru.keyPairs, keyName: "用户凭据", messageName: "图源", requiresPuppeteer: true }
  };
  for (const name2 in enhancerRegistry) {
    const entry = enhancerRegistry[name2];
    const generalConfig = config[name2];
    if (!entry.needsKeys || Array.isArray(entry.keys) && entry.keys.length > 0) {
      const constructorArgs = [ctx, generalConfig, config.debug];
      if (name2 === "yandere" || name2 === "gelbooru") constructorArgs.push(config.requestTimeout);
      if (entry.requiresPuppeteer) constructorArgs.push(puppeteerManager);
      allEnhancers[name2] = new entry.constructor(...constructorArgs);
    } else {
      logger14.info(`[${name2}] ${entry.messageName}未配置任何${entry.keyName}，将无法启用。`);
    }
  }
  const sortedEnhancers = config.enhancerOrder.filter((item) => item.enabled && allEnhancers[item.engine]).map((item) => allEnhancers[item.engine]);
  if (allEnabledSearchers.length > 0) {
    logger14.info(`已启用的搜图引擎顺序: ${allEnabledSearchers.map((s) => s.name).join(", ")}`);
  }
  if (sortedEnhancers.length > 0) {
    logger14.info(`已启用的图源顺序: ${sortedEnhancers.map((e) => e.name).join(", ")}`);
  }
  const searchHandler = new SearchHandler(ctx, config, allSearchers, allEnabledSearchers);
  ctx.command("sauce [...text:string]", "聚合搜图").alias("soutu", "搜图").option("all", "-a, --all 返回所有启用的引擎搜索结果").action(async ({ session, options }, text) => {
    function parseInput(inputText, options2) {
      const text2 = inputText || "";
      const words = text2.split(/\s+/).filter(Boolean);
      let searchersToUse2 = sequentialSearchers;
      let imageInput2 = text2;
      let isSingleEngineSpecified2 = false;
      const firstWord = words[0]?.toLowerCase();
      let targetEngineName = null;
      if (availableEngines.includes(firstWord)) {
        targetEngineName = firstWord;
      } else if (engineAliases[firstWord]) {
        targetEngineName = engineAliases[firstWord];
      }
      if (targetEngineName) {
        const targetSearcher = allSearchers[targetEngineName];
        if (targetSearcher) {
          searchersToUse2 = [targetSearcher];
          imageInput2 = words.slice(1).join(" ");
          isSingleEngineSpecified2 = true;
        }
      } else if (options2.all) {
        searchersToUse2 = allEnabledSearchers;
      }
      return { searchersToUse: searchersToUse2, imageInput: imageInput2, isSingleEngineSpecified: isSingleEngineSpecified2 };
    }
    __name(parseInput, "parseInput");
    const { searchersToUse, imageInput, isSingleEngineSpecified } = parseInput(text, options);
    if (isSingleEngineSpecified) {
      if (searchersToUse.length === 0) return "指定的搜图引擎无效或未正确配置。";
    } else {
      if (allEnabledSearchers.length === 0) return "沒有啟用或指定任何有效的搜图引擎。";
    }
    let imgData = getImageUrlAndName(session, imageInput);
    if (!imgData.url) {
      await session.send(`请发送图片... (超时: ${config.promptTimeout}秒)`);
      try {
        const nextMessageContent = await session.prompt(config.promptTimeout * 1e3);
        if (!nextMessageContent) return "已取消。";
        const unescapedContent = import_koishi15.h.unescape(nextMessageContent);
        imgData = getImageUrlAndName({ content: unescapedContent, quote: session.quote, elements: import_koishi15.h.parse(unescapedContent) }, unescapedContent);
        if (!imgData.url) return "未找到图片，已取消。";
      } catch (e) {
        return "等待超时，已取消。";
      }
    }
    try {
      await session.send("正在搜索...");
      const rawImageArrayBuffer = await ctx.http.get(imgData.url, { responseType: "arraybuffer" });
      if (!/\.(jpe?g|png|gif|webp)$/i.test(imgData.name)) {
        const imageType = detectImageType(import_buffer2.Buffer.from(rawImageArrayBuffer));
        if (imageType) {
          const newName = `${imgData.name}.${imageType}`;
          if (config.debug.enabled) logger14.info(`[Debug] Original filename "${imgData.name}" lacked extension. Renaming to "${newName}".`);
          imgData.name = newName;
        }
      }
      const processedImageBuffer = await preprocessImage(import_buffer2.Buffer.from(rawImageArrayBuffer));
      const searchOptions = {
        imageUrl: imgData.url,
        imageBuffer: processedImageBuffer,
        fileName: imgData.name,
        maxResults: config.maxResults
      };
      const botUser = await session.bot.getSelf();
      const collectedErrors = [];
      if (isSingleEngineSpecified || options.all) {
        return await searchHandler.handleDirectSearch(searchersToUse, searchOptions, botUser, session, collectedErrors);
      } else {
        return await searchHandler.handleSequentialSearch(searchersToUse, searchOptions, botUser, session, collectedErrors, sortedEnhancers);
      }
    } catch (error) {
      logger14.error("图片处理失败:", error);
      return "图片处理失败，请检查链接或网络。";
    }
  });
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name,
  usage,
  using
});
