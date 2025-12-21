import { Context, Logger } from 'koishi'
import { Config, Searcher, SearchOptions, Ascii2D as Ascii2DConfig, SearchEngineName } from '../config'
import type { PuppeteerManager } from '../puppeteer'
import type { Page } from 'puppeteer-core'

const logger = new Logger('sauce-aggregator')

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

        const startTime = Date.now()
        const page = await this.puppeteer.getPage()

        try {
            // 导航并输入图片 URL 提交搜索
            if (this.mainConfig.debug.enabled) logger.info('[ascii2d] 导航到 ascii2d.net')
            await page.goto('https://ascii2d.net/')

            const urlFormSelector = 'form[action="/search/uri"]'
            await page.waitForSelector(urlFormSelector)
            const inputSelector = `${urlFormSelector} input[name="uri"]`

            if (this.mainConfig.debug.enabled) logger.info('[ascii2d] 输入 URL 并提交')
            // 优化: 直接设置 input value，比 type 快且稳定
            await page.$eval(inputSelector, (input: HTMLInputElement, url: string) => {
                input.value = url
            }, options.imageUrl)

            const searchButtonSelector = `${urlFormSelector} button[type="submit"]`
            await Promise.all([
                // 优化: 改为 domcontentloaded，避免因广告脚本加载慢导致超时
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.click(searchButtonSelector),
            ])

            await page.waitForSelector('div.item-box')
            if (this.mainConfig.debug.enabled) logger.info(`[ascii2d] 已加载结果页: ${page.url()}`)

            const results = await this.parseResults(page)

            if (this.mainConfig.debug.enabled) {
                const duration = Date.now() - startTime
                logger.info(`[ascii2d] 搜索完成 (${duration}ms)，解析到 ${results.length} 个结果`)
            }

            return results.slice(0, options.maxResults)

        } catch (error) {
            // 错误记录与友好提示
            logger.error('[ascii2d] 搜索过程中发生错误:', error)
            if (this.mainConfig.debug.enabled) await this.puppeteer.saveErrorSnapshot(page, this.name)

            let friendlyMessage = 'Ascii2D 搜索失败。'
            if ((error as any).name === 'TimeoutError' || /timeout/i.test((error as Error).message)) {
                friendlyMessage += '页面加载超时，可能是网络或目标网站响应缓慢。'
            } else {
                friendlyMessage += `内部错误: ${(error as Error).message}`
            }
            throw new Error(friendlyMessage)

        } finally {
            if (page && !page.isClosed()) await page.close()
        }
    }

    // 解析颜色搜索结果：从 item-box 抽取缩略图、链接、作者等信息
    private async parseResults(page: Page): Promise<Searcher.Result[]> {
        // 优化: 合并数据遍历，直接返回最终结构
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
