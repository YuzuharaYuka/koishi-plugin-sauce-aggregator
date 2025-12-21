import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, SoutuBot as SoutuBotConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core'

// SoutuBot 搜索器：通过 Puppeteer 上传图片并解析页面结果
const logger = new Logger('sauce-aggregator')

export class SoutuBot extends Searcher<SoutuBotConfig.Config> {
    public readonly name: SearchEngineName = 'soutubot'
    private puppeteer: PuppeteerManager
    private readonly BASE_URL = 'https://soutubot.moe/'

    constructor(ctx: Context, mainConfig: Config, subConfig: SoutuBotConfig.Config, puppeteerManager: PuppeteerManager) {
        super(ctx, mainConfig, subConfig)
        this.puppeteer = puppeteerManager
    }

    // 主搜索方法：上传图片并解析结果
    async search(options: SearchOptions): Promise<Searcher.Result[]> {
        if (!options.tempFilePath) {
            logger.warn('[soutubot] 需要临时文件路径，已跳过')
            return []
        }

        const startTime = Date.now()
        const tempFilePath = options.tempFilePath
        const page = await this.puppeteer.getPage()

        try {
            // 导航到目标站点
            if (this.mainConfig.debug.enabled) logger.info(`[soutubot] 导航到: ${this.BASE_URL}`)
            await page.goto(this.BASE_URL, { waitUntil: 'domcontentloaded' })

            // 检查并处理 Cloudflare 人机验证
            if (await this.puppeteer.checkForCloudflare(page)) {
                if (this.mainConfig.debug.enabled && this.mainConfig.debug.logApiResponses.includes(this.name)) {
                    logger.info('[soutubot] 检测到 Cloudflare，保存页面快照')
                    await this.puppeteer.saveErrorSnapshot(page, `${this.name}-cloudflare`)
                }
                throw new Error('检测到 Cloudflare 人机验证页面。请尝试更换网络或禁用此引擎。')
            }

            // 上传图片文件
            const inputSelector = 'input[type="file"]'
            await page.waitForSelector(inputSelector, { timeout: this.mainConfig.requestTimeout * 1000 })
            const inputUploadHandle = await page.$(inputSelector)
            await inputUploadHandle.uploadFile(tempFilePath)

            // 等待结果或无结果提示
            const firstResultSelector = '.card-2'
            const noResultSelector = 'div.text-center > h3'
            if (this.mainConfig.debug.enabled) logger.info('[soutubot] 等待搜索结果加载')
            await page.waitForSelector(`${firstResultSelector}, ${noResultSelector}`, { timeout: this.mainConfig.requestTimeout * 1000 })
            if (this.mainConfig.debug.enabled) logger.info('[soutubot] 结果已加载，开始解析')

            // 解析并格式化结果
            const maxNeeded = Math.max(options.maxResults, this.subConfig.maxHighConfidenceResults || 1)
            const parsedResults = await this.parseResults(page, maxNeeded)
            const finalResults = this.formatResults(parsedResults)

            if (this.mainConfig.debug.enabled) {
                const duration = Date.now() - startTime
                logger.info(`[soutubot] 搜索完成 (${duration}ms)，返回 ${finalResults.length} 条结果`)
            }

            if (this.mainConfig.debug.logApiResponses.includes(this.name)) {
                logger.info(`[soutubot] Parsed JSON Response: ${JSON.stringify(parsedResults, null, 2)}`)
            }

            return finalResults

        } catch (error) {
            // 记录错误并保存调试快照（如果启用）
            logger.error('[soutubot] 搜索过程中发生错误:', error)
            if (this.mainConfig.debug.enabled) await this.puppeteer.saveErrorSnapshot(page, this.name)

            if ((error as Error).message.includes('Cloudflare')) throw error

            let friendlyMessage = '搜图bot酱 搜索失败。'
            if ((error as any).name === 'TimeoutError' || /timeout/i.test((error as Error).message)) {
                friendlyMessage += '页面操作超时，可能没有响应或未找到结果。'
            } else {
                friendlyMessage += `内部错误: ${(error as Error).message}`
            }
            throw new Error(friendlyMessage)

        } finally {
            if (page && !page.isClosed()) await page.close()
        }
    }

    // 从页面卡片中提取原始字段
    private async parseResults(page: Page, maxNeeded: number) {
        return page.$$eval('.card-2', (cards: HTMLDivElement[], maxNeeded) => {
            const langMap: Record<string, string> = { cn: '中文', jp: '日文', gb: '英文', kr: '韩文' }

            return cards.slice(0, maxNeeded).map((card) => {
                const similarityLabel = Array.from(card.querySelectorAll('span')).find((el) => el.textContent?.trim() === '匹配度:')
                const similarityText = similarityLabel?.nextElementSibling?.textContent?.trim().replace('%', '') || '0'
                const parsedSimilarity = parseFloat(similarityText)

                const title = (card.querySelector('.font-semibold span') as HTMLElement)?.innerText
                const thumbnail = (card.querySelector('a[target="_blank"] img') as HTMLImageElement)?.src

                const sourceImg = (card.querySelector('img[src*="/images/icons/"]') as HTMLImageElement)
                const sourceName = sourceImg ? sourceImg.src.split('/').pop()?.replace('.png', '') : '未知'

                const langFlag = card.querySelector('span.fi[class*="fi-"]')
                const langCode = langFlag ? Array.from(langFlag.classList).find((c) => c.startsWith('fi-'))?.replace('fi-', '') : null
                const language = langCode ? (langMap[(langCode as keyof typeof langMap)] || langCode) : null

                const detailPageLink = Array.from(card.querySelectorAll('a.el-button')).find((a) => a.textContent?.includes('详情页')) as HTMLAnchorElement
                const imagePageLink = Array.from(card.querySelectorAll('a.el-button')).find((a) => a.textContent?.includes('图片页')) as HTMLAnchorElement

                return {
                    thumbnail,
                    similarity: isNaN(parsedSimilarity) ? 0 : parsedSimilarity,
                    title,
                    sourceName,
                    language,
                    detailUrl: detailPageLink?.href,
                    imageUrl: imagePageLink?.href,
                    imagePageText: imagePageLink?.innerText.trim(),
                }
            }).filter(Boolean)
        }, maxNeeded)
    }

    // 将原始结果映射为 Searcher.Result
    private formatResults(rawResults: Awaited<ReturnType<typeof this.parseResults>>): Searcher.Result[] {
        return rawResults.map((res) => {
            const details: string[] = []
            if (res.language) details.push(`语言: ${res.language}`)

            // 尝试提取 ID
            const idMatch = res.detailUrl?.match(/\/g\/(\d+)/) || res.imageUrl?.match(/\/g\/(\d+)/)
            if (idMatch) {
                details.push(`ID: ${idMatch[1]}`)
            }

            const pageMatch = res.imagePageText?.match(/\(P(\d+)\)/)
            if (res.imageUrl) {
                let linkText = '图片页'
                if (pageMatch) linkText += ` (P${pageMatch[1]})`
                details.push(`${linkText}: ${res.imageUrl}`)
            }

            return {
                thumbnail: res.thumbnail,
                similarity: res.similarity,
                url: res.detailUrl || res.imageUrl,
                source: `[${res.sourceName}] ${res.title || '未知作品'}`,
                details,
            }
        }).filter(item => !!item.url) // 过滤掉没有有效链接的结果
    }
}
