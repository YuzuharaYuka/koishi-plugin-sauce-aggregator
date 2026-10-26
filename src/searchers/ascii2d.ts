import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, Ascii2D as Ascii2DConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core'
import { errorMessage, errorName } from '../utils'

// Ascii2D 搜索器
//
// 站点对 POST /search/uri 与 /search/file 施加 Cloudflare 托管挑战（实测直连 HTTP 返回 403），
// 因此必须经由浏览器提交：GET 首页拿到表单，再填 URL 提交。
// 由于挑战与站点抖动是偶发的，这里补上了挑战识别、失败原因诊断与自动重试。

const logger = new Logger('sauce-aggregator')

/** 结果出现前的轮询间隔（结果通常几秒内出现，轮询过慢会平白多等） */
const POLL_INTERVAL = 500
/** 重试之间的等待 */
const RETRY_DELAY = 2000

/** 页面当前处于哪种状态 */
type PagePhase = 'results' | 'empty' | 'challenge' | 'limited' | 'download_failed' | 'pending'

export class Ascii2D extends Searcher<Ascii2DConfig.Config> {
    public readonly name: SearchEngineName = 'ascii2d'
    private puppeteer: PuppeteerManager

    constructor(ctx: Context, mainConfig: Config, subConfig: Ascii2DConfig.Config, puppeteerManager: PuppeteerManager) {
        super(ctx, mainConfig, subConfig)
        this.puppeteer = puppeteerManager
    }

    // 主搜索方法：使用图片 URL 提交到 ascii2d 并解析结果
    async search(options: SearchOptions): Promise<Searcher.Result[]> {
        if (!options.imageUrl || !options.imageUrl.startsWith('http')) {
            logger.warn('[ascii2d] 需要有效的 HTTP/HTTPS 图片 URL，已跳过')
            return []
        }

        const retries = Math.max(0, this.subConfig.retries ?? 2)
        let lastError: Error | null = null
        let savedSnapshot = false

        for (let attempt = 0; attempt <= retries; attempt++) {
            const page = await this.puppeteer.getPage()
            try {
                const results = await this.runSearch(page, options)
                if (attempt > 0) {
                    logger.info(`[ascii2d] 第 ${attempt + 1} 次尝试成功，返回 ${results.length} 条结果`)
                }
                return results
            } catch (error) {
                lastError = error as Error
                const last = attempt === retries
                const message = errorMessage(error)

                // 失败时保存一次页面快照，便于定位是挑战、限流还是改版
                if (this.mainConfig.debug.enabled && !savedSnapshot) {
                    savedSnapshot = true
                    await this.puppeteer.saveErrorSnapshot(page, this.name).catch(() => { })
                }

                logger.warn(`[ascii2d] 第 ${attempt + 1}/${retries + 1} 次尝试失败: ${message}`)

                // 站点自己抓不到这张图，换几次都一样，直接给出结论
                if (/无法下载该图片/.test(message)) break

                if (!last) await this.ctx.sleep(RETRY_DELAY)
            } finally {
                if (!page.isClosed()) await page.close().catch(() => { })
            }
        }

        throw new Error(`Ascii2D 搜索失败。${this.describeFailure(lastError)}`)
    }

    /** 单次完整流程：导航 → 提交 → 等待并解析结果 */
    private async runSearch(page: Page, options: SearchOptions): Promise<Searcher.Result[]> {
        const startTime = Date.now()
        const totalTimeout = this.resolveTimeout()

        // 站点响应慢时，导航本身也要给足时间（默认 requestTimeout 可能偏短）
        const navTimeout = Math.max(this.mainConfig.requestTimeout * 1000, 20000)

        if (this.mainConfig.debug.enabled) logger.info('[ascii2d] 导航到首页')
        await page.goto('https://ascii2d.net/', { waitUntil: 'domcontentloaded', timeout: navTimeout })

        const urlFormSelector = 'form[action="/search/uri"]'
        await page.waitForSelector(urlFormSelector, { timeout: navTimeout })
        const inputSelector = `${urlFormSelector} input[name="uri"]`

        if (this.mainConfig.debug.enabled) logger.info('[ascii2d] 填入图片 URL 并提交')
        // 直接设置 input value，比 type 快且稳定
        await page.$eval(inputSelector, (input: HTMLInputElement, url: string) => {
            input.value = url
        }, options.imageUrl)

        await Promise.all([
            // domcontentloaded 即可，避免广告等第三方脚本拖慢
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: navTimeout }),
            page.click(`${urlFormSelector} button[type="submit"]`),
        ])

        const phase = await this.waitForOutcome(page, totalTimeout)

        if (phase === 'challenge') {
            throw new Error('Cloudflare 人机验证未通过')
        }
        if (phase === 'limited') {
            throw new Error('站点提示访问受限或搜索结果过多')
        }
        if (phase === 'download_failed') {
            throw new Error('站点无法下载该图片链接')
        }
        if (phase === 'pending') {
            const diag = await this.diagnose(page)
            throw new Error(`等待结果超时（${Math.round(totalTimeout / 1000)} 秒）${diag}`)
        }

        if (this.mainConfig.debug.enabled) logger.info(`[ascii2d] 已加载结果页: ${page.url()}（状态 ${phase}）`)

        const results = phase === 'results' ? await this.parseResults(page) : []

        if (this.mainConfig.debug.enabled) {
            logger.info(`[ascii2d] 搜索完成 (${Date.now() - startTime}ms)，解析到 ${results.length} 个结果`)
        }

        return results.slice(0, options.resultLimit)
    }

    /** 结果等待时间：取「配置值」与「全局请求超时」中的较大者 */
    private resolveTimeout(): number {
        const configured = (this.subConfig.resolveTimeout ?? 60) * 1000
        return Math.max(configured, this.mainConfig.requestTimeout * 1000)
    }

    /**
     * 轮询页面，直到出现结果 / 无结果 / 挑战 / 受限。
     * ascii2d 通过 Cloudflare 时页面可能先显示挑战，几秒后才渲染结果，所以不能只等一个选择器。
     */
    private async waitForOutcome(page: Page, timeout: number): Promise<PagePhase> {
        const deadline = Date.now() + timeout
        let last: PagePhase = 'pending'

        while (Date.now() < deadline) {
            last = await this.detectPhase(page)
            if (last !== 'pending') return last
            await this.ctx.sleep(POLL_INTERVAL)
        }

        // 超时前再判一次，避免恰好卡在边界
        return this.detectPhase(page)
    }

    /** 判断当前页面属于哪种状态 */
    private async detectPhase(page: Page): Promise<PagePhase> {
        try {
            return await page.evaluate(() => {
                const text = document.body?.innerText ?? ''
                const html = document.documentElement?.innerHTML ?? ''
                const title = document.title ?? ''

                if (document.querySelector('div.item-box')) return 'results'

                const challenge = /Just a moment|Checking your browser|Verifying you are human|_cf_chl_opt|challenge-platform|Attention Required/i.test(title + html)
                if (challenge) return 'challenge'

                if (/検索回数|アクセスが集中|しばらく|too many/i.test(text)) return 'limited'

                // ascii2d 抓不到图片时不会跳转，而是留在首页弹提示框
                // 「画像をダウンロードできません」「このURLからのダウンロードに失敗」
                if (/ダウンロードできません|ダウンロードに失敗/.test(text)) return 'download_failed'

                // 有表单说明还停在首页（尚未提交成功或提交被站点拒绝）
                if (document.querySelector('form[action="/search/uri"]')) return 'pending'

                // 已跳转到结果页但没有结果条目
                if (/\/search\/(color|bovw)\//.test(location.pathname)) return 'empty'

                // 页面已无表单也非结果页：可能是异常页，继续等一轮
                if (/検索結果|見つかりません|該当/i.test(text)) return 'empty'

                return 'pending'
            }) as PagePhase
        } catch {
            return 'pending'
        }
    }

    /** 失败时抓取页面关键信息，便于区分挑战 / 限流 / 改版 */
    private async diagnose(page: Page): Promise<string> {
        try {
            const info = await page.evaluate(() => ({
                title: document.title,
                path: location.pathname,
                hasForm: !!document.querySelector('form[action="/search/uri"]'),
                itemBox: document.querySelectorAll('div.item-box').length,
                text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 120),
            }))
            return `（页面: ${info.path} / 标题: ${info.title || '无'} / 表单: ${info.hasForm ? '有' : '无'} / 结果块: ${info.itemBox} / 文本: ${info.text || '空'}）`
        } catch {
            return ''
        }
    }

    /** 把失败原因转成用户可读的提示 */
    private describeFailure(error: Error | null): string {
        const message = errorMessage(error)
        if (/Cloudflare|人机验证/i.test(message)) {
            return '被 Cloudflare 人机验证拦截，可尝试更换代理网络后重试。'
        }
        if (/无法下载该图片/.test(message)) {
            return 'Ascii2D 无法下载该图片链接 (站点返回下载失败)。图片链接可能已过期，或该图床不允许它抓取。'
        }
        if (/访问受限/i.test(message)) {
            return '站点提示访问受限或结果过多，请稍后再试。'
        }
        if (errorName(error) === 'TimeoutError' || /超时|timeout/i.test(message)) {
            return '页面加载超时，可能是网络、代理或目标网站响应缓慢。'
        }
        return `内部错误: ${message}`
    }

    // 解析颜色搜索结果：从 item-box 抽取缩略图、链接、作者等信息
    private async parseResults(page: Page): Promise<Searcher.Result[]> {
        // 合并数据遍历，直接返回最终结构
        return await page.$$eval('div.item-box', (boxes: HTMLDivElement[]) => {
            return boxes.slice(1).map((box) => {
                if (box.querySelector('h5')?.textContent === '広告') return null

                const thumbnailEl = box.querySelector('img')
                const detailBox = box.querySelector('.detail-box')
                if (!thumbnailEl || !detailBox) return null

                const links = Array.from(detailBox.querySelectorAll('h6 a')) as HTMLAnchorElement[]
                if (links.length === 0) return null

                const sourceInfoEl = detailBox.querySelector('h6 small.text-muted')
                const sourceInfo = sourceInfoEl?.textContent || '未知来源'

                const authorLink = links.find((a) => a.href.includes('/users/') || a.href.includes('/i/user/'))
                const mainLink = links.find((a) => !a.href.includes('/users/') && !a.href.includes('/i/user/'))

                return {
                    thumbnail: new URL(thumbnailEl.src, location.origin).href,
                    similarity: 0,
                    url: mainLink?.href || null,
                    source: `[${sourceInfo}] ${mainLink?.textContent || ''}`.trim(),
                    author: authorLink?.textContent || null,
                    details: ['搜索类型: 色合検索'],
                }
            }).filter(Boolean) as any[]
        })
    }
}
