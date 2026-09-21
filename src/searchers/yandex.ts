// --- START OF FILE src/searchers/yandex.ts ---

import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, Yandex as YandexConfig, SearchEngineName } from '../config'
import { errorMessage, errorName } from '../utils'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core'

// Yandex 图片搜索器：使用 Puppeteer 上传图片并解析搜索结果
const logger = new Logger('sauce-aggregator')

export class Yandex extends Searcher<YandexConfig.Config> {
    public readonly name: SearchEngineName = 'yandex'
    private puppeteer: PuppeteerManager

    private static readonly SELECTORS = {
        COOKIE_POPUPS: [
            { selector: '#gdpr-popup-v3-button-all', name: 'GDPR v3' },
            { selector: 'button[data-testid="button-allow-all"]', name: 'Yandex cookies' },
        ],
        UPLOAD_BUTTON_NEW: '.Image-Uploader, button.Button2_view_action',
        UPLOAD_BUTTON_OLD: '.HeaderDesktopActions-CbirButton',
        OLD_UI_POPUP: '.CbirPanel-Popup',
        OLD_UI_FILE_BTN: '.CbirPanel-FileControlsButton',
        RESULTS_CONTAINER: '.CbirSites-Item, .CbirSimilar-Thumb',
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

        const startTime = Date.now()
        const tempFilePath = options.tempFilePath
        const page = await this.puppeteer.getPage()

        try {
            // 设置请求头以提高页面加载稳定性
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

            const url = `https://${this.subConfig.domain}/images/`
            if (this.mainConfig.debug.enabled) logger.info(`[yandex] 导航到: ${url}`)
            await page.goto(url, { waitUntil: 'domcontentloaded' })

            // 处理可能的 Cookie 弹窗
            await this.handleCookiePopups(page)

            // 上传图片（根据页面不同布局采用不同策略）
            const uploaded = await this.tryUploadImage(page, tempFilePath)
            if (!uploaded) throw new Error('未能在已知布局中成功上传图片')

            if (this.mainConfig.debug.enabled) logger.info('[yandex] 文件已提交，等待结果页面加载')

            await page.waitForSelector(Yandex.SELECTORS.RESULTS_CONTAINER, { timeout: this.mainConfig.requestTimeout * 1000 })
            if (this.mainConfig.debug.enabled) logger.info('[yandex] 结果已加载，开始解析')

            const results = await this._parseResults(page, options.maxResults)

            if (this.mainConfig.debug.enabled) {
                const duration = Date.now() - startTime
                logger.info(`[yandex] 搜索完成 (${duration}ms)，结果数: ${results.length}`)
            }

            if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
                logger.info(`[yandex] Parsed JSON Response: ${JSON.stringify(results, null, 2)}`)
            }

            return results

        } catch (error) {
            // 捕获并封装为用户友好的错误信息
            const message = errorMessage(error)
            logger.warn(`[yandex] 请求或解析出错: ${message}`)
            if (this.mainConfig.debug.enabled) await this.puppeteer.saveErrorSnapshot(page, this.name)

            let friendlyMessage = 'Yandex 搜索失败。'
            if (errorName(error) === 'TimeoutError' || /timeout/i.test(message)) {
                friendlyMessage += '页面加载超时，可能是网络或代理问题。'
            } else {
                friendlyMessage += `内部错误: ${message}`
            }
            throw new Error(friendlyMessage)
        } finally {
            if (page && !page.isClosed()) await page.close()
        }
    }

    // 检测并点击常见的 Cookie 接受弹窗
    private async handleCookiePopups(page: Page): Promise<void> {
        const cookiePopups = Yandex.SELECTORS.COOKIE_POPUPS

        if (this.mainConfig.debug.enabled) logger.info(`[yandex] 检查 ${cookiePopups.length} 种 Cookie 弹窗`)

        // 使用较短的超时时间 (3s)，避免无弹窗时长时间等待
        const popupTimeout = 3000

        const detectionPromises = cookiePopups.map((popup) =>
            (async () => {
                try {
                    await page.waitForSelector(popup.selector, { visible: true, timeout: popupTimeout })
                    if (this.mainConfig.debug.enabled) logger.info(`[yandex] 检测到 '${popup.name}'，尝试点击接受`)
                    await page.click(popup.selector)
                    // 点击后等待消失，也使用较短超时
                    await page.waitForSelector(popup.selector, { hidden: true, timeout: popupTimeout })
                } catch (e) {
                    // 未检测到此弹窗：忽略
                }
            })()
        )

        await Promise.allSettled(detectionPromises)
        if (this.mainConfig.debug.enabled) logger.info('[yandex] Cookie 弹窗处理完成')
    }

    // 根据不同 UI 布局尝试上传图片
    private async tryUploadImage(page: Page, filePath: string): Promise<boolean> {
        const newUiButtonSelector = Yandex.SELECTORS.UPLOAD_BUTTON_NEW
        const oldUiButtonSelector = Yandex.SELECTORS.UPLOAD_BUTTON_OLD

        // 给上传按钮检测更多时间 (10s 或配置值的一半)
        const uploadTimeout = Math.max(10000, this.mainConfig.requestTimeout * 500)

        if (this.mainConfig.debug.enabled) logger.info('[yandex] 检测页面上传入口')

        try {
            const raceResult = await Promise.race([
                page.waitForSelector(newUiButtonSelector, { visible: true, timeout: uploadTimeout }).then(() => 'new'),
                page.waitForSelector(oldUiButtonSelector, { visible: true, timeout: uploadTimeout }).then(() => 'old'),
            ])

            if (raceResult === 'new') {
                if (this.mainConfig.debug.enabled) logger.info('[yandex] 使用新版 UI 上传')
                const [fileChooser] = await Promise.all([
                    page.waitForFileChooser({ timeout: 10000 }),
                    page.click(newUiButtonSelector),
                ])
                await fileChooser.accept([filePath])
                if (this.mainConfig.debug.enabled) logger.info('[yandex] 新版上传成功')
                return true
            } else if (raceResult === 'old') {
                if (this.mainConfig.debug.enabled) logger.info('[yandex] 使用旧版 UI 上传')
                await page.click(oldUiButtonSelector)
                await page.waitForSelector(Yandex.SELECTORS.OLD_UI_POPUP, { visible: true, timeout: 5000 })
                const [fileChooser] = await Promise.all([
                    page.waitForFileChooser({ timeout: 10000 }),
                    page.click(Yandex.SELECTORS.OLD_UI_FILE_BTN),
                ])
                await fileChooser.accept([filePath])
                if (this.mainConfig.debug.enabled) logger.info('[yandex] 旧版上传成功')
                return true
            }
        } catch (e) {
            if (this.mainConfig.debug.enabled) logger.warn('[yandex] 上传流程失败: ' + (errorMessage(e) || e))
            return false
        }

        return false
    }

    // 从结果页 DOM 中解析搜索结果
    private async _parseResults(page: Page, maxResults: number): Promise<Searcher.Result[]> {
        const resultsSelector = Yandex.SELECTORS.RESULT_ITEMS
        await page.waitForSelector(resultsSelector, { timeout: 5000 })

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
            maxResults,
            Yandex.SELECTORS // 传递选择器到浏览器上下文
        )
    }
}
