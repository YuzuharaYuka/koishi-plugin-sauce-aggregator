import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, SoutuBot as SoutuBotConfig, SearchEngineName, SOUTUBOT_SEARCH_MODE_FACTOR } from '../config'
import { describeHttpError, fetchJsonWithProxy } from '../core/http'
import { ensureImageWithin } from '../core/image'

// SoutuBot（搜图bot酱）搜索器
//
// 站点在 2026-08 之后重写为单页应用，搜图请求是普通的 multipart 表单 POST：
//   POST https://soutubot.moe/api/search
//   file=<图片>, factor=1.2, metadata_mode=display, top_k=25
// 返回 application/json（schema 2.2），其中包含相似度分数与已解析的作品元数据。
//
// 因此本引擎不再依赖 Puppeteer / 浏览器实例：
// 既绕开了页面改版导致的 DOM 选择器失效，也避免了被浏览器指纹风控拦截。

const logger = new Logger('sauce-aggregator')

const DEFAULT_ENDPOINT = 'https://soutubot.moe/api/search'
const ORIGIN = 'https://soutubot.moe/'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ==================== 接口响应结构（仅声明用到的字段） ====================

interface SoutuBotNamedTag {
    name?: string
    tag?: string
    text?: string
}

interface SoutuBotTagGroup {
    artists?: SoutuBotNamedTag[]
    characters?: SoutuBotNamedTag[]
    works?: SoutuBotNamedTag[]
    general?: SoutuBotNamedTag[]
    other?: (SoutuBotNamedTag | string)[]
}

interface SoutuBotMetadata {
    display_kind?: 'booru' | 'doujinshi' | 'manhuacat' | string
    source?: { key?: string; name?: string; id?: string | number; url?: string }
    post?: { source_key?: string; post_id?: string | number; post_url?: string }
    external_id?: string | number
    source_key?: string
    title?: string | { primary?: string; japanese_or_alias?: string; romanized?: string }
    creators?: SoutuBotNamedTag[]
    works?: SoutuBotNamedTag[]
    characters?: SoutuBotNamedTag[]
    tags?: SoutuBotTagGroup
    facts?: { language?: string; category?: string; chapter?: string | number; page_count?: number }
    // manhuacat 变体
    work_title?: string
    work_id?: string | number
    chapter_id?: string | number
    chapter_title?: string
    page_number?: number | string
}
interface SoutuBotSegment {
    source_family?: string
    source_key?: string
    external_id?: string
    language?: string | null
    page_no?: number | null
    chapter_no?: number | null
    metadata_status?: string
    metadata?: SoutuBotMetadata | null
    thumbnail_url?: string | null
    source_url?: string | null
    page_url?: string | null
    chapter_url?: string | null
}

interface SoutuBotHit {
    score?: number
    path_segments?: SoutuBotSegment[]
}

interface SoutuBotResponse {
    schema_version?: string
    status?: string
    partial?: boolean
    result_id?: string
    warnings?: unknown[]
    timing?: { total_ms?: number }
    results?: SoutuBotHit[]
}

// 站内来源标识 -> 展示名
const SOURCE_NAMES: Record<string, string> = {
    nhentai: 'nhentai',
    ehentai: 'E-Hentai',
    exhentai: 'ExHentai',
    panda: 'Panda',
    jmcomic: 'JMComic',
    manhuacat: '漫画猫',
    dmzj: '动漫之家',
    pixiv: 'Pixiv',
    danbooru: 'Danbooru',
    gelbooru: 'Gelbooru',
    yandere: 'Yande.re',
    konachan: 'Konachan',
    zerochan: 'Zerochan',
    sankaku: 'Sankaku',
    e621: 'e621',
}

// 域名 -> 展示名，用于标注额外来源链接
const SITE_HOSTS: Record<string, string> = {
    'nhentai.net': 'nhentai',
    'e-hentai.org': 'E-Hentai',
    'exhentai.org': 'ExHentai',
    'pixiv.net': 'Pixiv',
    'twitter.com': 'Twitter',
    'x.com': 'X',
    'danbooru.donmai.us': 'Danbooru',
    'gelbooru.com': 'Gelbooru',
    'yande.re': 'Yande.re',
    'konachan.com': 'Konachan',
    'zerochan.net': 'Zerochan',
    'jmcomic.me': 'JMComic',
}

const LANGUAGE_NAMES: Record<string, string> = {
    chinese: '中文',
    japanese: '日文',
    english: '英文',
    korean: '韩文',
    zh: '中文',
    jp: '日文',
    en: '英文',
    kr: '韩文',
    french: '法文',
    german: '德文',
    spanish: '西班牙文',
    russian: '俄文',
    portuguese: '葡萄牙文',
    italian: '意大利文',
}

export class SoutuBot extends Searcher<SoutuBotConfig.Config> {
    public readonly name: SearchEngineName = 'soutubot'

    constructor(ctx: Context, mainConfig: Config, subConfig: SoutuBotConfig.Config) {
        super(ctx, mainConfig, subConfig)
        // 清理历史配置残留：该选项已移除，接口固定使用 display 模式
        delete (subConfig as Record<string, unknown>)?.metadataMode
    }

    // 主搜索方法：直接调用站点搜索接口
    async search(options: SearchOptions): Promise<Searcher.Result[]> {
        if (!options.imageBuffer?.length) {
            logger.warn('[soutubot] 缺少图片数据，已跳过')
            return []
        }

        const startTime = Date.now()
        const endpoint = (this.subConfig.apiEndpoint || '').trim() || DEFAULT_ENDPOINT
        const debugEnabled = this.mainConfig.debug.enabled
        const useProxy = this.subConfig.useProxy !== false
        const proxyUrl = useProxy ? this.mainConfig.proxy : undefined

        // 站点要求图片宽度不超过 2000 像素（高度同样受限）。
        // 全局预处理默认已压到 2000，这里兜底处理用户调大上限的情况。
        const prepared = await ensureImageWithin(options.imageBuffer, 2000, {
            quality: this.mainConfig.image?.quality ?? 90,
        })
        const uploadBuffer = prepared.buffer
        let uploadName = options.fileName
        if (prepared.changed) {
            uploadName = `${(options.fileName || 'image').replace(/\.[^./\\]+$/, '') || 'image'}.jpg`
            if (debugEnabled) {
                const info = prepared.info
                logger.info(`[soutubot] 图片已缩放到 ${info?.width}x${info?.height} 以符合站点限制`)
            }
        }

        const fileName = this.normalizeFileName(uploadName)
        const form = new FormData()
        form.append('file', new Blob([new Uint8Array(uploadBuffer)], { type: this.mimeTypeOf(fileName) }), fileName)
        form.append('factor', String(this.resolveFactor()))
        // 固定使用 display 模式：展示所需字段（标题/作者/标签/链接）已全部包含，
        // 且站点在 full 模式下限制结果数量必须 <= 10，display 无此限制。
        form.append('metadata_mode', 'display')
        form.append('top_k', String(this.subConfig.topK ?? 25))

        if (debugEnabled) {
            logger.info(`[soutubot] 发送请求到 ${endpoint}，图片大小: ${uploadBuffer.length} 字节，代理: ${proxyUrl || '直连'}`)
        }

        let payload: SoutuBotResponse
        try {
            payload = await fetchJsonWithProxy<SoutuBotResponse>(endpoint, {
                method: 'POST',
                body: form,
                proxyUrl,
                timeout: this.mainConfig.requestTimeout * 1000,
                retries: 1,
                retryDelay: 1200,
                debug: debugEnabled ? (message) => logger.info(`[soutubot] ${message}`) : undefined,
                headers: {
                    accept: 'application/json',
                    'accept-language': 'zh-CN',
                    origin: ORIGIN.replace(/\/$/, ''),
                    referer: ORIGIN,
                    'user-agent': USER_AGENT,
                },
            })
        } catch (error) {
            const message = describeHttpError(error)
            if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
                logger.warn(`[soutubot] 请求失败详情: ${message}`)
            }
            throw new Error(`搜图bot酱 搜索失败。${this.formatRequestError(message)}`)
        }

        if (debugEnabled) {
            logger.info(`[soutubot] 收到响应 (${Date.now() - startTime}ms)，schema: ${payload?.schema_version || '未知'}，候选: ${payload?.results?.length ?? 0} 条`)
        }

        if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
            logger.info(`[soutubot] Parsed JSON Response: ${JSON.stringify(payload, null, 2)}`)
        }

        const rawResults = this.parseResults(payload)
        const finalResults = this.formatResults(rawResults, options.maxResults)

        if (debugEnabled) {
            logger.info(`[soutubot] 搜索完成 (${Date.now() - startTime}ms)，结果数: ${finalResults.length}`)
        }

        return finalResults
    }

    /**
     * 解析站点 factor 参数。
     * 优先使用下拉选项（常规 1.2 / 严格 1.4），
     * 同时兼容历史配置中直接写入的数字。
     */
    private resolveFactor(): number {
        const legacy = (this.subConfig as Record<string, unknown>).factor
        if (typeof legacy === 'number' && Number.isFinite(legacy)) return legacy
        return SOUTUBOT_SEARCH_MODE_FACTOR[this.subConfig.searchMode || 'normal']
            ?? SOUTUBOT_SEARCH_MODE_FACTOR.normal
    }

    /** 文件名兜底：接口需要一个带扩展名的文件名 */
    private normalizeFileName(fileName?: string): string {
        const safe = (fileName || 'image.jpg').replace(/[\r\n"';\\/]+/g, '_').trim()
        if (!safe) return 'image.jpg'
        return /\.[a-z0-9]{2,5}$/i.test(safe) ? safe : `${safe}.jpg`
    }

    /**
     * 依据文件名推断 MIME 类型。
     * 站点会校验上传文件的 Content-Type（缺失时返回 415「仅支持常见图片格式」），
     * 因此不能固定写成 image/jpeg。
     */
    private mimeTypeOf(fileName: string): string {
        const ext = fileName.split('.').pop()?.toLowerCase()
        switch (ext) {
            case 'png': return 'image/png'
            case 'gif': return 'image/gif'
            case 'webp': return 'image/webp'
            case 'bmp': return 'image/bmp'
            case 'avif': return 'image/avif'
            case 'jpeg':
            case 'jpg':
            default: return 'image/jpeg'
        }
    }

    /** 将接口错误转成用户可读的提示（风控场景单独提示） */
    private formatRequestError(message: string): string {
        if (/429/.test(message) || /too many|rate.?limit|频繁/i.test(message)) {
            return '请求过于频繁，站点已触发限流，请稍后再试。'
        }
        if (/422/.test(message) || /结果数量必须/.test(message)) {
            return `请求参数被站点拒绝 (${message})，请检查图片尺寸与「候选结果数量」。`
        }
        if (/40[13]|503/.test(message)) {
            return '站点拒绝了本次请求 (可能触发了风控)，请更换代理网络或稍后再试。'
        }
        if (/415/.test(message) || /图片格式/.test(message)) {
            return '站点不支持该图片格式，请改用 JPG / PNG 图片。'
        }
        if (/超时|abort|timeout|ETIMEDOUT/i.test(message)) {
            return '请求超时，请检查网络或代理设置。'
        }
        return `接口错误: ${message}`
    }

    /** 从接口响应中提取并展平候选结果 */
    private parseResults(payload: SoutuBotResponse): RawResult[] {
        const hits = payload?.results || []
        if (!Array.isArray(hits) || hits.length === 0) return []

        const parsed: RawResult[] = []

        for (const hit of hits) {
            const score = Number(hit?.score || 0)
            for (const segment of hit?.path_segments || []) {
                const item = this.parseSegment(segment, score)
                if (item) parsed.push(item)
            }
        }

        // 同一作品可能命中多个页面，只保留最有用的一条，避免刷屏
        const deduped = new Map<string, RawResult>()
        for (const item of parsed) {
            const existing = deduped.get(item.dedupeKey)
            if (!existing || this.betterCandidate(item, existing)) deduped.set(item.dedupeKey, item)
        }

        return [...deduped.values()].sort((a, b) => this.rankScore(b) - this.rankScore(a))
    }

    /**
     * 排序权重：相似度为主，元数据完整的略作加权。
     * 站点对「路径推断」的条目与已收录条目会给出完全相同的分数，
     * 这里让信息更完整的一条优先展示。
     */
    private rankScore(item: RawResult): number {
        return item.similarity + (item.metadataStatus === 'found' && item.title ? 0.5 : 0)
    }

    /** 同一作品的多条命中：优先取信息完整的，其次取页码更靠前的 */
    private betterCandidate(candidate: RawResult, current: RawResult): boolean {
        const candidateRank = this.rankScore(candidate)
        const currentRank = this.rankScore(current)
        if (candidateRank !== currentRank) return candidateRank > currentRank

        const candidatePage = candidate.pageNo ?? Number.MAX_SAFE_INTEGER
        const currentPage = current.pageNo ?? Number.MAX_SAFE_INTEGER
        return candidatePage < currentPage
    }

    /** 解析单个路径片段 */
    private parseSegment(segment: SoutuBotSegment | null | undefined, score: number): RawResult | null {
        if (!segment) return null

        const metadata = segment.metadata || {}
        const sourceKey = String(
            metadata.source?.key || metadata.post?.source_key || metadata.source_key || segment.source_key || 'unknown'
        ).toLowerCase()
        const externalId = String(
            metadata.source?.id || metadata.post?.post_id || metadata.external_id || segment.external_id || ''
        )
        const detailUrl = segment.source_url || metadata.source?.url || metadata.post?.post_url || undefined
        const link = detailUrl || segment.page_url || segment.chapter_url || undefined
        const thumbnail = segment.thumbnail_url || detailUrl || segment.page_url || undefined
        const url = link || thumbnail

        // 既没有可跳转链接也没有缩略图的结果没有展示价值
        if (!url) return null

        // 页码仅在确实是图集内页时才有意义（pixiv 等来源会把作品 ID 塞在 page_no 里）
        const pageNo = this.extractPageNo(metadata, segment)
        const chapter = metadata.facts?.chapter ?? metadata.chapter_id ?? segment.chapter_no ?? undefined

        return {
            similarity: Number.isFinite(score) ? score : 0,
            thumbnail: thumbnail || '',
            url: url!,
            linkUrl: link,
            sourceKey,
            sourceName: metadata.source?.name || SOURCE_NAMES[sourceKey] || sourceKey,
            externalId,
            title: this.extractTitle(metadata),
            titleAlt: this.extractTitleAlt(metadata),
            author: this.extractAuthor(metadata),
            language: this.extractLanguage(metadata, segment),
            category: metadata.facts?.category || metadata.display_kind || undefined,
            creators: this.tagNames(metadata.creators),
            works: this.tagNames(metadata.works),
            characters: this.tagNames(metadata.characters),
            tags: this.extractTags(metadata),
            pageNo,
            pageCount: metadata.facts?.page_count,
            chapter,
            chapterTitle: metadata.chapter_title,
            pageUrl: segment.page_url || undefined,
            chapterUrl: segment.chapter_url || undefined,
            sourceLinks: this.extractSourceLinks(metadata, sourceKey, externalId),
            metadataStatus: segment.metadata_status,
            dedupeKey: `${sourceKey}#${externalId || segment.page_url || segment.thumbnail_url || Math.random()}`,
        }
    }

    private extractTitle(metadata: SoutuBotMetadata): string | undefined {
        const title = metadata.title
        if (typeof title === 'string') return title
        return title?.primary || title?.japanese_or_alias || metadata.work_title || undefined
    }

    private extractTitleAlt(metadata: SoutuBotMetadata): string | undefined {
        const title = metadata.title
        if (typeof title !== 'object' || !title) return undefined
        return title.japanese_or_alias || undefined
    }

    private extractPageNo(metadata: SoutuBotMetadata, segment: SoutuBotSegment): number | null {
        if (metadata.display_kind === 'manhuacat') return null
        if (metadata.source?.key && metadata.source.key === 'pixiv') return null
        if (segment.source_key === 'pixiv') return null
        return segment.page_no ?? null
    }

    /** 收集同作品的其他来源链接（镜像站 / 原始出处） */
    private extractSourceLinks(metadata: SoutuBotMetadata, sourceKey: string, externalId: string): string[] {
        const raw = metadata as unknown as {
            source_links?: Array<{ kind?: string; value?: string; url?: string }>
            mirrors?: Array<{ source_key?: string; post_id?: string | number; post_url?: string }>
        }

        const links: string[] = []

        for (const item of raw.source_links || []) {
            if (item?.url && /^https?:\/\//i.test(item.url)) {
                const label = item.kind === 'pixiv' && item.value ? `Pixiv #${item.value}` : SITE_HOSTS[this.hostnameOf(item.url)] || this.hostnameOf(item.url)
                links.push(`${label}: ${item.url}`)
            }
        }

        for (const mirror of raw.mirrors || []) {
            const key = String(mirror?.source_key || '').toLowerCase()
            if (!mirror?.post_url || !/^https?:\/\//i.test(mirror.post_url)) continue
            // 与主来源重复时跳过
            if (key === sourceKey && String(mirror.post_id ?? '') === externalId) continue
            links.push(`镜像 ${SOURCE_NAMES[key] || key}: ${mirror.post_url}`)
        }

        return [...new Set(links)].slice(0, 4)
    }

    private hostnameOf(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, '')
        } catch {
            return url
        }
    }

    private extractAuthor(metadata: SoutuBotMetadata): string | undefined {
        const creators = this.tagNames(metadata.creators)
        if (creators.length) return creators.join(', ')
        const artists = this.tagNames(metadata.tags?.artists)
        if (artists.length) return artists.join(', ')
        return undefined
    }

    private extractLanguage(metadata: SoutuBotMetadata, segment: SoutuBotSegment): string | undefined {
        const raw = metadata.facts?.language || segment.language
        if (!raw) return undefined
        const key = String(raw).toLowerCase()
        return LANGUAGE_NAMES[key] || String(raw)
    }

    /** 归一化标签数组：支持 { name } / { text } / 纯字符串 */
    private tagNames(tags?: (SoutuBotNamedTag | string)[]): string[] {
        if (!Array.isArray(tags)) return []
        return tags
            .map((tag) => (typeof tag === 'string' ? tag : tag?.name || tag?.text || tag?.tag))
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim())
    }

    private extractTags(metadata: SoutuBotMetadata): string[] {
        const groups = [metadata.tags?.general, metadata.tags?.other]
        const tags = groups.flatMap((group) => this.tagNames(group))
        // 去掉 "artist:" / "language:" 之类的前缀噪音，并截断长度
        return tags.map((tag) => tag.replace(/^[a-z_]+:/i, '')).slice(0, 12)
    }

    /** 将原始结果映射为 Searcher.Result */
    private formatResults(rawResults: RawResult[], maxResults: number): Searcher.Result[] {
        const limit = Math.max(maxResults || 0, this.subConfig.maxHighConfidenceResults || 1)

        return rawResults.slice(0, limit).map((res) => {
            const details: string[] = []
            const idLabel = res.externalId ? `${res.sourceName} #${res.externalId}` : res.sourceName

            if (res.titleAlt && res.titleAlt !== res.title) details.push(`别名: ${res.titleAlt}`)
            if (res.creators.length) details.push(`作者: ${res.creators.join(', ')}`)
            if (res.works.length) details.push(`作品: ${res.works.join(', ')}`)
            if (res.characters.length) details.push(`角色: ${res.characters.slice(0, 8).join(', ')}`)
            if (res.language) details.push(`语言: ${res.language}`)
            if (res.category) details.push(`类型: ${res.category}`)
            if (res.chapter) {
                const title = res.chapterTitle ? ` ${res.chapterTitle}` : ''
                details.push(`章节: ${res.chapter}${title}`)
            }
            if (res.pageNo != null) {
                details.push(res.pageCount ? `页码: ${res.pageNo} / ${res.pageCount}` : `页码: ${res.pageNo}`)
            }
            if (res.tags.length) details.push(`标签: ${res.tags.join(', ')}`)
            if (res.pageUrl) details.push(`图片页: ${res.pageUrl}`)
            if (res.chapterUrl && res.chapterUrl !== res.pageUrl) details.push(`章节页: ${res.chapterUrl}`)
            if (res.metadataStatus === 'path_derived') details.push('元数据: 由路径推断')
            else if (res.metadataStatus === 'known_unimported' || res.metadataStatus === 'not_found' || !res.title) {
                details.push('元数据: 站点未收录，仅提供路径')
            }
            if (res.sourceLinks.length) details.push(`其他来源: ${res.sourceLinks.join(' | ')}`)

            // 作品标题：漫画猫等来源没有独立标题字段，用「作品 · 章节」组合
            const workTitle = res.title || (res.works.length ? res.works.join('、') : undefined)
            const heading = workTitle
                ? (res.chapter ? `${workTitle} · 章节 ${res.chapter}` : workTitle)
                : '未知作品'

            return {
                thumbnail: res.thumbnail,
                similarity: res.similarity,
                url: res.url,
                source: `[${idLabel}] ${heading}`,
                author: res.author,
                details,
            }
        }).filter((item) => !!item.url)
    }
}

interface RawResult {
    similarity: number
    thumbnail: string
    url: string
    linkUrl?: string
    sourceKey: string
    sourceName: string
    externalId: string
    title?: string
    titleAlt?: string
    author?: string
    language?: string
    category?: string
    creators: string[]
    works: string[]
    characters: string[]
    tags: string[]
    pageNo: number | null
    pageCount?: number
    chapter?: string | number
    chapterTitle?: string
    pageUrl?: string
    chapterUrl?: string
    sourceLinks: string[]
    metadataStatus?: string
    dedupeKey: string
}
