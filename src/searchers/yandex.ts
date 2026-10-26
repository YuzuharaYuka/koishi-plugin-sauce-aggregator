// --- START OF FILE src/searchers/yandex.ts ---

import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, Yandex as YandexConfig, SearchEngineName } from '../config'
import { errorMessage, errorName } from '../utils'
import type { PuppeteerManager } from '../puppeteer'
import type { ElementHandle, Page } from 'puppeteer-core'

// Yandex 图片搜索器：使用 Puppeteer 上传图片并解析搜索结果
//
// Yandex 图片页是 SPA：DOM 里的上传按钮会先于事件绑定出现，
// 水合完成前点击不会有任何反应。旧实现只等固定 5 秒就判定面板未打开，
// 网络稍慢（JS 包未加载完）就必然失败，因此这里补上了：
//   · 等待上传组件水合 + 网络静默
//   · 打开上传面板的重试
//   · 直接向隐藏 file input 注入文件（不走原生文件选择器）
//   · 失败原因诊断与自动重试
const logger = new Logger('sauce-aggregator')

/** 重试之间的等待 */
const RETRY_DELAY = 2000
/** 上传组件水合完成的等待上限 */
const UPLOADER_READY_TIMEOUT = 15000
/** 打开上传面板的等待上限与尝试次数 */
const PANEL_OPEN_TIMEOUT = 5000
const PANEL_OPEN_ATTEMPTS = 3
/** 提交图片后等待跳转结果页的上限 */
const SUBMIT_TIMEOUT = 45000
/** 网络静默的等待上限（第三方请求可能长时间不结束；实测 8s 时几乎必然超时） */
const NETWORK_IDLE_TIMEOUT = 1500
/** 结果等待时间下限（秒），与全局请求超时取较大值 */
const RESULT_TIMEOUT_FLOOR = 45
/** 隐藏固定悬浮、可能拦截点击的推广浮层 */
const OVERLAY_STYLE = '.DistributionPopup,.CbirIntent{display:none!important}'

export class Yandex extends Searcher<YandexConfig.Config> {
    public readonly name: SearchEngineName = 'yandex'
    private puppeteer: PuppeteerManager

    private static readonly SELECTORS = {
        // 上传组件已由 JS 接管的标记
        UPLOADER_READY: '.cbir-uploader_js_inited, .CbirCore-FileInput',
        // 打开上传面板的入口（搜索框右侧的相机按钮）
        PANEL_OPENER: '.HeaderDesktopActions-CbirButton, .Image-Uploader, button.Button2_view_action',
        UPLOAD_PANEL: '.CbirPanel-Popup',
        // 真正承载文件的原生输入框
        FILE_INPUT: '.CbirCore-FileInput, input[type=file]',
        // 结果区：站点结果、相似图片、以及站点明确给出「无结果」的模板
        RESULTS_CONTAINER: '.CbirSites-Item, .CbirSimilarList-Thumb, .CbirLayoutTemplate_empty',
        EMPTY_MARKER: '.CbirLayoutTemplate_empty',
        RESULT_ITEMS: '.CbirSites-Item, .CbirSimilar-Item',
        RESULT_THUMB: 'img',
        RESULT_TITLE: '.CbirSites-ItemTitle a, .CbirSimilar-Title',
        RESULT_DOMAIN: '.CbirSites-ItemDomain, .CbirSimilar-Domain',
        RESULT_SIZE: '.Thumb-Mark',
    }

    constructor(ctx: Context, mainConfig: Config, subConfig: YandexConfig.Config, puppeteerManager: PuppeteerManager) {
        super(ctx, mainConfig, subConfig)
        this.puppeteer = puppeteerManager
    }

    // 主搜索入口：上传图片并解析返回结果列表
    async search(options: SearchOptions): Promise<Searcher.Result[]> {
        if (!options.tempFilePath) {
            logger.warn('[yandex] 需要临时文件路径，已跳过')
            return []
        }

        const retries = Math.max(0, this.subConfig.retries ?? 1)
        let lastError: Error | null = null
        let savedSnapshot = false

        for (let attempt = 0; attempt <= retries; attempt++) {
            const page = await this.puppeteer.getPage()
            try {
                const results = await this.runSearch(page, options)
                if (attempt > 0) logger.info(`[yandex] 第 ${attempt + 1} 次尝试成功，返回 ${results.length} 条结果`)
                return results
            } catch (error) {
                lastError = error as Error
                const last = attempt === retries
                const message = errorMessage(error)

                // 失败时保存一次页面快照，便于定位是改版、风控还是网络问题
                if (this.mainConfig.debug.enabled && !savedSnapshot) {
                    savedSnapshot = true
                    await this.puppeteer.saveErrorSnapshot(page, this.name).catch(() => { })
                }

                logger.warn(`[yandex] 第 ${attempt + 1}/${retries + 1} 次尝试失败: ${message}`)

                if (!last) await this.ctx.sleep(RETRY_DELAY)
            } finally {
                if (!page.isClosed()) await page.close().catch(() => { })
            }
        }

        throw new Error(`Yandex 搜索失败。${this.describeFailure(lastError)}`)
    }

    /** 单次完整流程：导航 → 打开面板 → 提交图片 → 等待并解析结果 */
    private async runSearch(page: Page, options: SearchOptions): Promise<Searcher.Result[]> {
        const startTime = Date.now()

        // 站点响应慢时，导航本身也要给足时间
        const navTimeout = Math.max(this.mainConfig.requestTimeout * 1000, 20000)

        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

        const url = `https://${this.subConfig.domain}/images/`
        if (this.mainConfig.debug.enabled) logger.info(`[yandex] 导航到: ${url}`)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout })

        await this.preparePage(page)
        await this.submitImage(page, options.tempFilePath!)

        const empty = await this.waitForResults(page)

        const results = empty ? [] : await this._parseResults(page, options.resultLimit)

        if (this.mainConfig.debug.enabled) {
            const duration = Date.now() - startTime
            logger.info(`[yandex] 搜索完成 (${duration}ms)，结果数: ${results.length}`)
        }

        if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
            logger.info(`[yandex] Parsed JSON Response: ${JSON.stringify(results, null, 2)}`)
        }

        return results
    }

    /**
     * 等待上传组件就绪，并隐藏会拦截点击的推广浮层。
     * 页面刚 domcontentloaded 时按钮虽然已在 DOM 里，但事件尚未绑定，
     * 此时点击是空点击——这是「面板打不开」的根因。
     */
    private async preparePage(page: Page): Promise<void> {
        await page.waitForSelector(Yandex.SELECTORS.UPLOADER_READY, { timeout: UPLOADER_READY_TIMEOUT }).catch(() => {
            if (this.mainConfig.debug.enabled) logger.warn('[yandex] 未检测到上传组件水合标记，仍继续尝试')
        })

        // 「将 Yandex 设为默认搜索」等浮层固定悬浮在页面上，可能挡住上传面板
        await page.addStyleTag({ content: OVERLAY_STYLE }).catch(() => { })

        // 页面常驻第三方请求，实测 8s 的 networkidle 几乎必然等到超时；
        // 水合标记已出现，这里只留一个短窗口，点击失败由 openUploadPanel 的重试兜底
        await page.waitForNetworkIdle({ idleTime: 300, timeout: NETWORK_IDLE_TIMEOUT }).catch(() => { })
    }

    /** 打开上传面板并注入文件 */
    private async submitImage(page: Page, filePath: string): Promise<void> {
        await this.openUploadPanel(page)

        const input = await page.waitForSelector(Yandex.SELECTORS.FILE_INPUT, { timeout: PANEL_OPEN_TIMEOUT })
        if (!input) throw new Error('未找到文件上传入口')

        // 直接向隐藏的 file input 注入文件，比走原生文件选择器更稳定
        if (this.mainConfig.debug.enabled) logger.info('[yandex] 提交图片')
        await (input as ElementHandle<HTMLInputElement>).uploadFile(filePath)

        // 提交成功后站点会跳转到 /images/search?rpt=imageview&url=...
        try {
            await page.waitForFunction(() => /rpt=imageview/.test(location.href), { timeout: SUBMIT_TIMEOUT })
        } catch {
            throw new Error('提交后页面未跳转到结果页')
        }

        if (this.mainConfig.debug.enabled) logger.info('[yandex] 文件已提交，等待结果页面加载')
    }

    /** 点击相机按钮打开上传面板；水合未完成时点击无效，因此带重试 */
    private async openUploadPanel(page: Page): Promise<void> {
        let lastError: unknown = null

        for (let attempt = 1; attempt <= PANEL_OPEN_ATTEMPTS; attempt++) {
            try {
                const opener = await page.waitForSelector(Yandex.SELECTORS.PANEL_OPENER, { visible: true, timeout: PANEL_OPEN_TIMEOUT })
                if (!opener) throw new Error('未找到上传按钮')

                await opener.click()
                await page.waitForSelector(Yandex.SELECTORS.UPLOAD_PANEL, { visible: true, timeout: PANEL_OPEN_TIMEOUT })

                if (this.mainConfig.debug.enabled) logger.info(`[yandex] 上传面板已打开（第 ${attempt} 次尝试）`)
                return
            } catch (error) {
                lastError = error
                if (this.mainConfig.debug.enabled) {
                    logger.warn(`[yandex] 第 ${attempt}/${PANEL_OPEN_ATTEMPTS} 次打开上传面板失败: ${errorMessage(error)}`)
                }
                if (attempt < PANEL_OPEN_ATTEMPTS) await this.ctx.sleep(RETRY_DELAY)
            }
        }

        throw new Error(`未能打开上传面板（${errorMessage(lastError) || '未知原因'}）`)
    }

    /** 等待结果渲染；返回 true 表示站点明确给出了「无相似结果」 */
    private async waitForResults(page: Page): Promise<boolean> {
        const timeout = Math.max(this.mainConfig.requestTimeout, RESULT_TIMEOUT_FLOOR) * 1000

        try {
            await page.waitForSelector(Yandex.SELECTORS.RESULTS_CONTAINER, { timeout })
        } catch {
            const diag = await this.diagnose(page)
            throw new Error(`等待结果超时（${Math.round(timeout / 1000)} 秒）${diag}`)
        }

        const items = await page.$$(Yandex.SELECTORS.RESULT_ITEMS)
        if (items.length > 0) return false

        const empty = await page.$(Yandex.SELECTORS.EMPTY_MARKER)
        if (empty) {
            if (this.mainConfig.debug.enabled) logger.info('[yandex] 站点未返回相似结果')
            return true
        }

        return false
    }

    /** 失败时抓取页面关键信息，便于区分改版、风控与网络问题 */
    private async diagnose(page: Page): Promise<string> {
        try {
            const info = await page.evaluate(() => ({
                title: document.title,
                path: location.pathname,
                uploader: !!document.querySelector('.cbir-uploader'),
                panel: !!document.querySelector('.CbirPanel-Popup'),
                items: document.querySelectorAll('.CbirSites-Item').length,
                text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 120),
            }))
            return `（页面: ${info.path} / 标题: ${info.title || '无'} / 上传组件: ${info.uploader ? '有' : '无'} / 面板: ${info.panel ? '开' : '关'} / 结果块: ${info.items} / 文本: ${info.text || '空'}）`
        } catch {
            return ''
        }
    }

    /** 把失败原因转成用户可读的提示 */
    private describeFailure(error: Error | null): string {
        const message = errorMessage(error)
        if (/上传面板/.test(message)) {
            return '未能打开 Yandex 的上传面板，页面可能未加载完整或被风控拦截，可稍后重试。'
        }
        if (/未跳转到结果页/.test(message)) {
            return '图片提交后页面没有跳转，可能是网络中断或站点限流，请稍后重试。'
        }
        if (errorName(error) === 'TimeoutError' || /超时|timeout/i.test(message)) {
            return '页面加载超时，可能是网络、代理或目标网站响应缓慢。'
        }
        return `内部错误: ${message}`
    }

    // 从结果页 DOM 中解析搜索结果
    private async _parseResults(page: Page, resultLimit: number): Promise<Searcher.Result[]> {
        const resultsSelector = Yandex.SELECTORS.RESULT_ITEMS

        // 结果区已在上一步确认渲染完成，这里不再单独等待，
        // 否则只要某一类结果缺失就会被误判为超时
        return page.$$eval(
            resultsSelector,
            (items, max, selectors) => {
                const parsedResults: any[] = []
                for (const item of items.slice(0, max)) {
                    const thumbElement = item.querySelector(selectors.RESULT_THUMB) as HTMLImageElement
                    const titleElement = item.querySelector(selectors.RESULT_TITLE) as HTMLAnchorElement
                    const domainElement = item.querySelector(selectors.RESULT_DOMAIN) as HTMLAnchorElement
                    const sizeElement = item.querySelector(selectors.RESULT_SIZE)

                    if (!thumbElement || !titleElement) continue

                    let thumbnailUrl = thumbElement.src
                    // 使用 URL 构造函数处理相对路径，确保 URL 完整
                    try {
                        thumbnailUrl = new URL(thumbnailUrl, document.baseURI).href
                    } catch (e) {
                        // 保持原样
                    }

                    const details: string[] = []
                    if (sizeElement) details.push(`尺寸: ${sizeElement.textContent.trim()}`)

                    parsedResults.push({
                        thumbnail: thumbnailUrl,
                        similarity: 0,
                        url: titleElement.href,
                        source: domainElement?.textContent?.trim() || '未知来源',
                        details: [
                            `标题: ${titleElement.textContent.trim()}`,
                            ...details,
                        ],
                    })
                }
                return parsedResults
            },
            resultLimit,
            Yandex.SELECTORS // 传递选择器到浏览器上下文
        )
    }
}
