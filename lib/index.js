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
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  usage: () => usage,
  using: () => using
});
module.exports = __toCommonJS(src_exports);
var import_koishi7 = require("koishi");

// src/config.ts
var import_koishi = require("koishi");
var Config = import_koishi.Schema.object({
  order: import_koishi.Schema.array(import_koishi.Schema.object({
    engine: import_koishi.Schema.union(["saucenao", "iqdb", "tracemoe"]).description("搜图引擎"),
    enabled: import_koishi.Schema.boolean().default(true).description("是否启用")
  })).role("table").default([
    { engine: "saucenao", enabled: true },
    { engine: "iqdb", enabled: true },
    { engine: "tracemoe", enabled: true }
  ]).description("搜图引擎调用顺序与开关 (可拖拽排序)。"),
  // **MODIFICATION START**: 统一术语为 "图源"
  enhancerOrder: import_koishi.Schema.array(import_koishi.Schema.object({
    engine: import_koishi.Schema.union(["gelbooru", "yandere"]).description("图源"),
    enabled: import_koishi.Schema.boolean().default(true).description("是否启用")
  })).role("table").default([
    { engine: "yandere", enabled: true },
    { engine: "gelbooru", enabled: true }
  ]).description("图源调用顺序 (找到高置信度结果后按序调用)。"),
  confidenceThreshold: import_koishi.Schema.number().default(85).min(0).max(100).description("高置信度结果的相似度阈值 (%)。"),
  maxResults: import_koishi.Schema.number().default(3).description("无高置信度结果时，各引擎最大显示数量。"),
  promptTimeout: import_koishi.Schema.number().default(60).description("等待用户发送图片的超时时间 (秒)。"),
  debug: import_koishi.Schema.boolean().default(false).description("启用Debug模式，输出详细日志。"),
  saucenao: import_koishi.Schema.object({
    apiKeys: import_koishi.Schema.array(import_koishi.Schema.string().role("secret")).description("SauceNAO 的 API Key 列表。\n\n注册登录 saucenao.com，在底部选项 `Account` -> `api` -> `api key`中生成。\n\n将api key: 后字符串完整复制并填入。")
  }).description("SauceNAO 设置"),
  tracemoe: import_koishi.Schema.object({
    sendVideoPreview: import_koishi.Schema.boolean().default(true).description("高置信度结果发送预览视频。")
  }).description("Trace.moe 设置"),
  iqdb: import_koishi.Schema.object({}).description("IQDB 设置"),
  yandere: import_koishi.Schema.object({
    enabled: import_koishi.Schema.boolean().default(true).description("启用 Yande.re 图源。"),
    postQuality: import_koishi.Schema.union([
      import_koishi.Schema.const("original").description("原图 (最大)"),
      import_koishi.Schema.const("jpeg").description("中等图 (中等)"),
      import_koishi.Schema.const("sample").description("预览图 (最小)")
    ]).default("jpeg").description("发送的图片尺寸。"),
    maxRating: import_koishi.Schema.union([
      import_koishi.Schema.const("s").description("Safe (安全)"),
      import_koishi.Schema.const("q").description("Questionable (可疑)"),
      import_koishi.Schema.const("e").description("Explicit (露骨)")
    ]).default("s").description("允许的最高内容评级。")
  }).description("Yande.re 图源设置"),
  gelbooru: import_koishi.Schema.object({
    enabled: import_koishi.Schema.boolean().default(true).description("启用 Gelbooru 图源。"),
    keyPairs: import_koishi.Schema.array(import_koishi.Schema.object({
      userId: import_koishi.Schema.string().description("Gelbooru User ID").required(),
      apiKey: import_koishi.Schema.string().role("secret").description("Gelbooru API Key").required()
    })).description("Gelbooru API Key 。\n\n注册登录 gelbooru.com，在 `My Account` -> `Options` 底部选项卡``API Access Credentials``中生成。\n\n形如`&api_key={ API Key }&user_id={ User ID }` { }中的才是需要填入的。"),
    postQuality: import_koishi.Schema.union([
      import_koishi.Schema.const("original").description("原图 (最大)"),
      import_koishi.Schema.const("sample").description("预览图 (较大)"),
      import_koishi.Schema.const("preview").description("缩略图 (最小)")
    ]).default("sample").description("发送的图片尺寸。"),
    maxRating: import_koishi.Schema.union([
      import_koishi.Schema.const("general").description("General"),
      import_koishi.Schema.const("sensitive").description("Sensitive"),
      import_koishi.Schema.const("questionable").description("Questionable"),
      import_koishi.Schema.const("explicit").description("Explicit")
    ]).default("general").description("允许的最高内容评级。")
  }).description("Gelbooru 图源设置")
  // **MODIFICATION END**
});

// src/searchers/saucenao.ts
var import_koishi2 = require("koishi");
var import_form_data = __toESM(require("form-data"));
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
  constructor(ctx, config, debug) {
    this.ctx = ctx;
    this.config = config;
    this.debug = debug;
  }
  static {
    __name(this, "SauceNAO");
  }
  name = "saucenao";
  keyIndex = 0;
  async search(options) {
    const apiKeys = this.config.apiKeys;
    if (!apiKeys || apiKeys.length === 0) {
      logger.warn("[saucenao] 未配置任何 API Key。");
      return [];
    }
    const currentApiKey = apiKeys[this.keyIndex];
    if (this.debug) {
      logger.info(`[saucenao] 使用 API Key 列表中的第 ${this.keyIndex + 1} 个 Key。`);
    }
    this.keyIndex = (this.keyIndex + 1) % apiKeys.length;
    const form = new import_form_data.default();
    form.append("output_type", 2);
    form.append("api_key", currentApiKey);
    form.append("file", options.imageBuffer, options.fileName);
    const url = "https://saucenao.com/search.php";
    if (this.debug) logger.info(`[saucenao] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`);
    try {
      const data = await this.ctx.http.post(url, form.getBuffer(), { headers: form.getHeaders() });
      if (this.debug) logger.info(`[saucenao] 收到响应: ${JSON.stringify(data, null, 2)}`);
      if (!data?.header) {
        logger.warn("[saucenao] 响应格式不正确，缺少 header。");
        return [];
      }
      if (data.header.status !== 0) {
        logger.warn(`[saucenao] API 返回错误状态: ${data.header.status}。消息: ${data.header.message || "未知错误"}`);
        return [];
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
      if (this.debug && error.response) {
        logger.debug(`[saucenao] 响应状态: ${error.response.status}`);
        logger.debug(`[saucenao] 响应数据: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
};

// src/searchers/tracemoe.ts
var import_koishi3 = require("koishi");
var import_form_data2 = __toESM(require("form-data"));
var logger2 = new import_koishi3.Logger("sauce-aggregator");
var TraceMoe = class {
  constructor(ctx, config, debug) {
    this.ctx = ctx;
    this.config = config;
    this.debug = debug;
  }
  static {
    __name(this, "TraceMoe");
  }
  name = "tracemoe";
  async search(options) {
    const form = new import_form_data2.default();
    form.append("image", options.imageBuffer, options.fileName);
    const url = "https://api.trace.moe/search?cutBorders&anilistInfo";
    if (this.debug) logger2.info(`[tracemoe] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`);
    try {
      const { result } = await this.ctx.http.post(url, form.getBuffer(), { headers: form.getHeaders() });
      if (this.debug) logger2.info(`[tracemoe] 收到响应: ${JSON.stringify(result, null, 2)}`);
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
          const h5 = Math.floor(seconds / 3600).toString().padStart(2, "0");
          const m = Math.floor(seconds % 3600 / 60).toString().padStart(2, "0");
          const s = Math.floor(seconds % 60).toString().padStart(2, "0");
          return `${h5}:${m}:${s}`;
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
      if (this.debug && error.response) {
        logger2.debug(`[tracemoe] 响应状态: ${error.response.status}`);
        logger2.debug(`[tracemoe] 响应数据: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
};

// src/searchers/iqdb.ts
var import_koishi4 = require("koishi");
var cheerio = __toESM(require("cheerio"));
var import_form_data3 = __toESM(require("form-data"));
var logger3 = new import_koishi4.Logger("sauce-aggregator");
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
  constructor(ctx, config, debug) {
    this.ctx = ctx;
    this.config = config;
    this.debug = debug;
  }
  static {
    __name(this, "IQDB");
  }
  name = "iqdb";
  async search(options) {
    const form = new import_form_data3.default();
    form.append("file", options.imageBuffer, options.fileName);
    const url = "https://iqdb.org/";
    if (this.debug) logger3.info(`[iqdb] 发送请求到 ${url}，图片大小: ${options.imageBuffer.length} 字节`);
    try {
      const html = await this.ctx.http.post(url, form.getBuffer(), {
        headers: {
          ...form.getHeaders(),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          "Referer": "https://iqdb.org/"
        }
      });
      logger3.info(`[iqdb] 收到响应页面，长度: ${html.length}`);
      const $ = cheerio.load(html);
      const results = [];
      const resultElements = $("#pages > div, #more1 > .pages > div");
      if (resultElements.length === 0 && !html.includes("No relevant results found")) {
        if (this.debug) logger3.warn("[iqdb] 页面结构可能已更改，未找到结果容器。");
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
          if (this.debug) logger3.error("[iqdb] 解析单个结果时出错:", parseError);
        }
      });
      return results.filter((r) => r.thumbnail && r.url);
    } catch (error) {
      logger3.warn(`[iqdb] 请求出错: ${error.message}`);
      if (this.debug && error.response) {
        logger3.debug(`[iqdb] 响应状态: ${error.response.status}`);
        logger3.debug(`[iqdb] 响应数据: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
};

// src/index.ts
var import_sharp = __toESM(require("sharp"));
var import_buffer = require("buffer");

// src/searchers/yande.ts
var import_koishi5 = require("koishi");
var logger4 = new import_koishi5.Logger("sauce-aggregator");
var YandeReEnhancer = class {
  // **MODIFICATION END**
  constructor(ctx, config, debug) {
    this.ctx = ctx;
    this.config = config;
    this.debug = debug;
  }
  static {
    __name(this, "YandeReEnhancer");
  }
  // **MODIFICATION START**: 显式声明 name 的字面量类型
  name = "yandere";
  async enhance(result) {
    const yandeReUrl = this.findYandeReUrl(result);
    if (!yandeReUrl) return null;
    const postId = this.parsePostId(yandeReUrl);
    if (!postId) return null;
    if (this.debug) logger4.info(`[yande.re] 检测到 Yande.re 链接，帖子 ID: ${postId}，开始获取图源信息...`);
    try {
      const apiUrl = `https://yande.re/post.json?tags=id:${postId}`;
      const response = await this.ctx.http.get(apiUrl);
      if (!response || response.length === 0) {
        if (this.debug) logger4.warn(`[yande.re] API 未能找到 ID 为 ${postId} 的帖子。`);
        return null;
      }
      const post = response[0];
      const ratingHierarchy = { s: 1, q: 2, e: 3 };
      const postRatingLevel = ratingHierarchy[post.rating];
      const maxAllowedLevel = ratingHierarchy[this.config.maxRating];
      if (postRatingLevel > maxAllowedLevel) {
        if (this.debug) logger4.info(`[yande.re] 帖子 ${postId} 的评级为 '${post.rating.toUpperCase()}'，超出了配置允许的最高等级 '${this.config.maxRating.toUpperCase()}'，已跳过。`);
        return { details: [import_koishi5.h.text(`[!] Yande.re 图源的评级 (${post.rating.toUpperCase()}) 超出设置，已隐藏详情。`)] };
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
      if (this.debug) logger4.info(`[yande.re] 正在下载图源图片 (${this.config.postQuality} 质量)... URL: ${downloadUrl}`);
      const imageBuffer = Buffer.from(await this.ctx.http.get(downloadUrl, { responseType: "arraybuffer" }));
      const imageType = this.getImageType(downloadUrl);
      return { details, imageBuffer, imageType };
    } catch (error) {
      logger4.error(`[yande.re] 获取图源信息 (ID: ${postId}) 时发生错误:`, error);
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
  getImageType(url) {
    if (url.endsWith(".png")) return "image/png";
    if (url.endsWith(".gif")) return "image/gif";
    return "image/jpeg";
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
    const tags = post.tags.split(" ").filter(Boolean);
    const displayedTags = tags.slice(0, 15).join(", ");
    const remainingCount = tags.length - 15;
    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);
    return [import_koishi5.h.text(info.join("\n"))];
  }
};

// src/searchers/gelbooru.ts
var import_koishi6 = require("koishi");
var logger5 = new import_koishi6.Logger("sauce-aggregator");
var GelbooruEnhancer = class {
  // **MODIFICATION END**
  constructor(ctx, config, debug) {
    this.ctx = ctx;
    this.config = config;
    this.debug = debug;
  }
  static {
    __name(this, "GelbooruEnhancer");
  }
  // **MODIFICATION START**: 显式声明 name 的字面量类型
  name = "gelbooru";
  async enhance(result) {
    const gelbooruUrl = this.findGelbooruUrl(result);
    if (!gelbooruUrl) return null;
    const postId = this.parseParam(gelbooruUrl, "id");
    const postMd5 = this.parseParam(gelbooruUrl, "md5");
    if (!postId && !postMd5) {
      if (this.debug) logger5.info(`[gelbooru] 在链接 ${gelbooruUrl} 中未找到有效的 id 或 md5 参数。`);
      return null;
    }
    const logIdentifier = postId ? `ID: ${postId}` : `MD5: ${postMd5}`;
    if (this.debug) logger5.info(`[gelbooru] 检测到 Gelbooru 链接，${logIdentifier}，开始获取图源信息...`);
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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        },
        params: apiParams
      });
      if (this.debug) {
        logger5.info(`[gelbooru] API 响应: ${JSON.stringify(response, null, 2)}`);
      }
      const post = response?.post?.[0];
      if (!post || !post.id) {
        if (this.debug) logger5.warn(`[gelbooru] API 未能找到帖子 (${logIdentifier})。`);
        return null;
      }
      const ratingHierarchy = { general: 1, sensitive: 2, questionable: 3, explicit: 4 };
      const postRatingLevel = ratingHierarchy[post.rating];
      const maxAllowedLevel = ratingHierarchy[this.config.maxRating];
      if (postRatingLevel > maxAllowedLevel) {
        if (this.debug) logger5.info(`[gelbooru] 帖子 ${post.id} 的评级 '${post.rating}' 超出设置 '${this.config.maxRating}'，已跳过。`);
        return { details: [import_koishi6.h.text(`[!] Gelbooru 图源的评级 (${post.rating}) 超出设置，已隐藏详情。`)] };
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
        if (this.debug) logger5.warn(`[gelbooru] 帖子 ${post.id} 缺少 ${this.config.postQuality} 质量的图片URL，将尝试使用 sample_url。`);
        downloadUrl = post.sample_url;
      }
      if (!downloadUrl) {
        if (this.debug) logger5.warn(`[gelbooru] 帖子 ${post.id} 缺少任何可用的图片URL。`);
        return { details };
      }
      if (this.debug) logger5.info(`[gelbooru] 正在下载图源图片 (${this.config.postQuality} 质量)... URL: ${downloadUrl}`);
      const imageBuffer = Buffer.from(await this.ctx.http.get(downloadUrl, { responseType: "arraybuffer" }));
      const imageType = this.getImageType(downloadUrl);
      return { details, imageBuffer, imageType };
    } catch (error) {
      logger5.error(`[gelbooru] 获取图源信息 (${logIdentifier}) 时发生错误:`, error);
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
  getImageType(url) {
    const ext = url.split(".").pop()?.toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "gif") return "image/gif";
    return "image/jpeg";
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
    const tags = post.tags.split(" ").filter(Boolean);
    const displayedTags = tags.slice(0, 15).join(", ");
    const remainingCount = tags.length - 15;
    let tagsText = `标签: ${displayedTags}`;
    if (remainingCount > 0) {
      tagsText += `... (及其他 ${remainingCount} 个)`;
    }
    info.push(tagsText);
    return [import_koishi6.h.text(info.join("\n"))];
  }
};

// src/index.ts
var name = "sauce-aggregator";
var using = [];
var inject = ["http"];
var logger6 = new import_koishi7.Logger(name);
var usage = `
指令: sauce [图片]
别名: 搜图, soutu
选项: --all / -a (搜索全部引擎)

支持直接发送图片、回复图片或发送图片链接。
`;
async function preprocessImage(buffer, maxSizeInMB = 4) {
  const ONE_MB = 1024 * 1024;
  if (buffer.length <= maxSizeInMB * ONE_MB) return buffer;
  logger6.info(`图片体积 (${(buffer.length / ONE_MB).toFixed(2)}MB) 超出 ${maxSizeInMB}MB，正在压缩...`);
  try {
    return await (0, import_sharp.default)(buffer).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch (error) {
    logger6.error("图片压缩失败:", error);
    return buffer;
  }
}
__name(preprocessImage, "preprocessImage");
function apply(ctx, config) {
  const allSearchers = {};
  const allEnhancers = {};
  if (config.yandere.enabled) {
    allEnhancers.yandere = new YandeReEnhancer(ctx, config.yandere, config.debug);
  }
  if (config.gelbooru.enabled && config.gelbooru.keyPairs?.length > 0) {
    allEnhancers.gelbooru = new GelbooruEnhancer(ctx, config.gelbooru, config.debug);
  } else if (config.gelbooru.enabled) {
    logger6.info("[gelbooru] 图源已启用但未配置任何 API Key，已禁用。");
  }
  if (config.saucenao.apiKeys && config.saucenao.apiKeys.length > 0) {
    allSearchers.saucenao = new SauceNAO(ctx, config.saucenao, config.debug);
  } else {
    logger6.info("[saucenao] 未提供任何 API Key，引擎已禁用。");
  }
  allSearchers.tracemoe = new TraceMoe(ctx, config.tracemoe, config.debug);
  allSearchers.iqdb = new IQDB(ctx, config.iqdb, config.debug);
  const sortedSearchers = config.order.filter((item) => item.enabled && allSearchers[item.engine]).map((item) => allSearchers[item.engine]);
  const sortedEnhancers = config.enhancerOrder.filter((item) => item.enabled && allEnhancers[item.engine]).map((item) => allEnhancers[item.engine]);
  if (sortedEnhancers.length > 0) {
    logger6.info(`已启用的图源顺序: ${sortedEnhancers.map((e) => e.name).join(", ")}`);
  }
  ctx.command("sauce [image:text]", "聚合搜图").alias("soutu", "搜图").option("all", "-a, --all 返回所有启用的引擎搜索结果").action(async ({ session, options }, image) => {
    let imgData;
    imgData = await getImageUrlAndName(session, image);
    if (!imgData.url) {
      await session.send(`请发送图片... (超时: ${config.promptTimeout}秒)`);
      try {
        const nextMessageContent = await session.prompt(config.promptTimeout * 1e3);
        if (!nextMessageContent) return "已取消。";
        imgData = await getImageUrlAndName({ content: nextMessageContent, quote: null }, nextMessageContent);
        if (!imgData.url) return "未找到图片，已取消。";
      } catch (e) {
        return "已超时。";
      }
    }
    try {
      const initialMessage = options.all ? "正在进行全量搜索..." : "正在搜索...";
      await session.send(initialMessage);
      const rawImageArrayBuffer = await ctx.http.get(imgData.url, { responseType: "arraybuffer" });
      const processedImageBuffer = await preprocessImage(import_buffer.Buffer.from(rawImageArrayBuffer));
      const searchOptions = {
        imageUrl: imgData.url,
        imageBuffer: processedImageBuffer,
        fileName: imgData.name,
        maxResults: config.maxResults
      };
      const performSearch = /* @__PURE__ */ __name(async (searcher) => {
        try {
          const results = await searcher.search(searchOptions);
          return { engine: searcher.name, results };
        } catch (error) {
          logger6.warn(`引擎 ${searcher.name} 搜索失败:`, config.debug ? error : error.message);
          return { engine: searcher.name, results: [] };
        }
      }, "performSearch");
      const searcherOutputs = await Promise.all(sortedSearchers.map(performSearch));
      const hasAnyResult = searcherOutputs.some((o) => o.results.length > 0);
      if (!hasAnyResult) return "未找到任何结果。";
      const botUser = await session.bot.getSelf();
      if (!options.all) {
        for (const searcher of sortedSearchers) {
          const output = searcherOutputs.find((o) => o.engine === searcher.name);
          const highConfidenceResult = output?.results.find((r) => r.similarity >= config.confidenceThreshold);
          if (highConfidenceResult) {
            try {
              await session.send(`引擎 ${searcher.name} 找到高置信度结果:`);
              const figureMessage2 = (0, import_koishi7.h)("figure");
              if (highConfidenceResult.coverImage) {
                figureMessage2.children.push((0, import_koishi7.h)("message", { nickname: "番剧封面", avatar: botUser.avatar }, import_koishi7.h.image(highConfidenceResult.coverImage)));
              }
              const detailsNode = (0, import_koishi7.h)("message", { nickname: "详细信息", avatar: botUser.avatar }, formatResult(highConfidenceResult));
              figureMessage2.children.push(detailsNode);
              if (searcher.name === "tracemoe" && config.tracemoe.sendVideoPreview && highConfidenceResult.url) {
                try {
                  logger6.info(`[tracemoe] 正在为高置信度结果下载视频预览...`);
                  const videoPreview = await ctx.http.get(highConfidenceResult.url, { responseType: "arraybuffer" });
                  figureMessage2.children.push((0, import_koishi7.h)("message", { nickname: "视频预览", avatar: botUser.avatar }, import_koishi7.h.video(videoPreview, "video/mp4")));
                } catch (e) {
                  logger6.warn(`[tracemoe] 高置信度视频预览下载失败: ${e.message}`);
                }
              }
              for (const enhancer of sortedEnhancers) {
                try {
                  const enhancedData = await enhancer.enhance(highConfidenceResult);
                  if (enhancedData) {
                    logger6.info(`[${enhancer.name}] 已成功获取图源信息。`);
                    if (enhancedData.imageBuffer) {
                      figureMessage2.children.push((0, import_koishi7.h)("message", { nickname: "图源图片", avatar: botUser.avatar }, import_koishi7.h.image(enhancedData.imageBuffer, enhancedData.imageType)));
                    }
                    const enhancedDetailsNode = (0, import_koishi7.h)("message", { nickname: "图源信息", avatar: botUser.avatar }, enhancedData.details);
                    figureMessage2.children.push(enhancedDetailsNode);
                    break;
                  }
                } catch (e) {
                  logger6.warn(`[${enhancer.name}] 图源处理时发生错误:`, e);
                }
              }
              await session.send(figureMessage2);
              return;
            } catch (error) {
              logger6.warn(`引擎 ${searcher.name} 的高置信度结果发送失败:`, error.message);
              await session.send(`[!] ${searcher.name} 结果发送失败，尝试下一引擎...`);
            }
          }
        }
      }
      const introMessage = options.all ? "全量搜索结果:" : "未找到高置信度结果，显示如下:";
      await session.send(introMessage);
      const figureMessage = (0, import_koishi7.h)("figure");
      const nodePromises = searcherOutputs.flatMap((output) => {
        if (output.results.length === 0) return [];
        const headerNode = Promise.resolve((0, import_koishi7.h)("message", { nickname: `--- ${output.engine} ---`, avatar: botUser.avatar }));
        const resultNodesPromises = output.results.slice(0, config.maxResults).map(async (result) => {
          try {
            const imageBuffer = import_buffer.Buffer.from(await ctx.http.get(result.thumbnail, { responseType: "arraybuffer" }));
            const imageBase64 = imageBuffer.toString("base64");
            const dataUri = `data:image/jpeg;base64,${imageBase64}`;
            const textFields = [
              `相似度: ${result.similarity.toFixed(2)}%`,
              result.source ? `来源: ${result.source}` : null,
              result.author ? `作者: ${result.author}` : null,
              result.time ? `时间: ${result.time}` : null,
              ...result.details || [],
              result.url ? `预览链接: ${result.url}` : null
            ].filter(Boolean);
            const content = [
              import_koishi7.h.image(dataUri),
              import_koishi7.h.text("\n" + textFields.join("\n"))
            ];
            return (0, import_koishi7.h)("message", {
              nickname: (result.source || output.engine).substring(0, 10),
              avatar: botUser.avatar
            }, content);
          } catch (e) {
            logger6.warn(`Failed to download thumbnail ${result.thumbnail}:`, e.message);
            const errorContent = import_koishi7.h.text(`[!] 缩略图加载失败
相似度: ${result.similarity.toFixed(2)}%
来源: ${result.source}
链接: ${result.url || "N/A"}`);
            return (0, import_koishi7.h)("message", {
              nickname: (result.source || output.engine).substring(0, 10),
              avatar: botUser.avatar
            }, errorContent);
          }
        });
        return [headerNode, ...resultNodesPromises];
      });
      const resolvedNodes = await Promise.all(nodePromises);
      figureMessage.children.push(...resolvedNodes);
      if (figureMessage.children.length > 0) {
        try {
          await session.send(figureMessage);
        } catch (e) {
          logger6.warn("合并转发低置信度结果失败:", e.message);
          await session.send("结果发送失败，请检查适配器兼容性。");
        }
      }
    } catch (error) {
      logger6.error("图片处理失败:", error);
      return "图片处理失败，请检查链接或网络。";
    }
  });
}
__name(apply, "apply");
async function getImageUrlAndName(session, text) {
  const getUrl = /* @__PURE__ */ __name((element) => element?.attrs.src, "getUrl");
  let url;
  if (session.quote?.content) url = import_koishi7.h.select(session.quote.content, "img").map(getUrl)[0];
  if (!url && session.content) url = import_koishi7.h.select(session.content, "img").map(getUrl)[0];
  if (!url && text && text.startsWith("http")) url = text;
  if (!url) return { url: null, name: null };
  const rawName = url.split("/").pop().split("?")[0] || "image.jpg";
  const name2 = rawName.replace(/[\r\n"']+/g, "");
  return { url, name: name2 };
}
__name(getImageUrlAndName, "getImageUrlAndName");
function formatResult(result) {
  const textFields = [
    `相似度: ${result.similarity.toFixed(2)}%`,
    result.source ? `来源: ${result.source}` : null,
    result.author ? `作者: ${result.author}` : null,
    result.time ? `时间: ${result.time}` : null,
    ...result.details || [],
    result.url ? `预览链接: ${result.url}` : null
  ].filter(Boolean);
  const content = [
    import_koishi7.h.image(result.thumbnail),
    import_koishi7.h.text("\n" + textFields.join("\n"))
  ];
  return content;
}
__name(formatResult, "formatResult");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name,
  usage,
  using
});
