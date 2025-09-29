// --- START OF FILE src/utils.ts ---
import { Buffer } from 'buffer';
import { decodeJPEGFromStream, decodePNGFromStream, encodeJPEGToStream, encodePNGToStream, make } from 'pureimage';
import { Readable, PassThrough } from 'stream';
import { Context, Logger, h } from 'koishi';

const logger = new Logger('sauce-aggregator:utils');

// 为 getImageUrlAndName 定义一个更精确的类型，以兼容真实和模拟的 Session 对象
interface ImageSource {
  elements?: h[];
  quote?: { elements?: h[] };
  app?: Context['app'];
}

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 带重试逻辑的通用文件下载函数
export async function downloadWithRetry(ctx: Context, url: string, options: { retries: number; timeout: number, headers?: Record<string, string> }): Promise<Buffer> {
    let lastError: Error = null;
    for (let i = 0; i <= options.retries; i++) {
        try {
            const buffer = await ctx.http.get(url, {
                responseType: 'arraybuffer',
                timeout: options.timeout,
                headers: options.headers,
            });
            return Buffer.from(buffer);
        } catch (error) {
            lastError = error;
            if (i < options.retries) {
                logger.warn(`[下载器] 下载失败 ${url} (尝试 ${i + 1}/${options.retries + 1}): ${error.message}，2秒后重试...`);
                await ctx.sleep(2000);
            }
        }
    }
    logger.warn(`[下载器] 下载 ${url} 失败 (${options.retries + 1}次尝试)。`);
    throw lastError;
}

// 从消息元素中提取纯文本内容
export function extractPlainText(elements: h[]): string {
    if (!elements) return '';
    return h.select(elements, 'text').map(e => e.attrs.content).join('').trim();
}

// 从URL中推断图片MIME类型
export function getImageTypeFromUrl(url: string): string {
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return 'image/jpeg';
  }
}

// 通过文件头（Magic Number）检测图片类型
export function detectImageType(buffer: Buffer): 'jpeg' | 'png' | null {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
    return null;
}
  
// 对体积过大的图片进行压缩和缩放处理
export async function preprocessImage(buffer: Buffer, maxSizeInMB = 4): Promise<Buffer> {
    const ONE_MB = 1024 * 1024;
    if (buffer.length <= maxSizeInMB * ONE_MB) return buffer;
  
    logger.info(`图片体积 (${(buffer.length / ONE_MB).toFixed(2)}MB) 超出 ${maxSizeInMB}MB，正在压缩...`);
    
    try {
      const imageType = detectImageType(buffer);
      if (!imageType) {
        logger.warn(`不支持的图片格式，无法压缩，将使用原图。`);
        return buffer;
      }
  
      const stream = Readable.from(buffer);
      const image = imageType === 'jpeg'
        ? await decodeJPEGFromStream(stream)
        : await decodePNGFromStream(stream);
  
      const MAX_DIMENSION = 2000;
      const ratio = Math.min(MAX_DIMENSION / image.width, MAX_DIMENSION / image.height, 1);
      const newWidth = Math.round(image.width * ratio);
      const newHeight = Math.round(image.height * ratio);
  
      const newCanvas = make(newWidth, newHeight);
      const ctx = newCanvas.getContext('2d');
      ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, newWidth, newHeight);
  
      const passThrough = new PassThrough();
      const chunks: Buffer[] = [];
      passThrough.on('data', chunk => chunks.push(chunk));
      
      const encodePromise = imageType === 'jpeg'
        ? encodeJPEGToStream(newCanvas, passThrough, 90)
        : encodePNGToStream(newCanvas, passThrough);
  
      await encodePromise;
      const finalBuffer = Buffer.concat(chunks);
      logger.info(`图片压缩完成，新体积: ${(finalBuffer.length / ONE_MB).toFixed(2)}MB`);
      return finalBuffer;
  
    } catch (error) {
      logger.error('图片压缩失败:', error);
      return buffer;
    }
}

// 从 Session 或模拟对象中按优先级解析出图片URL和文件名
export function getImageUrlAndName(session: ImageSource, text: string): { url: string; name: string } {
    let url: string;
    let imgElement: h;
    let textToParse = text;

    imgElement = session.elements?.find(e => e.type === 'img');
    url = imgElement?.attrs.src;
    
    if (!url) {
        const rawCurrentText = extractPlainText(session.elements);
        if (rawCurrentText) {
            textToParse = rawCurrentText;
        }
    }
    
    if (!url && session.quote) {
        imgElement = session.quote.elements?.find(e => e.type === 'img');
        url = imgElement?.attrs.src;
        if (!url) {
            textToParse = extractPlainText(session.quote.elements);
        }
    }

    if (!url && textToParse) {
        try {
            const potentialUrl = textToParse.trim().split(/\s+/)[0];
            new URL(potentialUrl);
            if (potentialUrl.startsWith('http')) {
                url = potentialUrl;
            }
        } catch {}
    }

    if (!url) return { url: null, name: null };
    
    const rawName = (imgElement?.attrs.file || url.split('/').pop().split('?')[0]) || 'image.jpg';
    const name = rawName.replace(/[\r\n"']+/g, '');

    if (session.app?.config.debug) {
      logger.info(`[Debug] 解析到图片 URL: ${url}`);
    }
    return { url, name };
}
// --- END OF FILE src/utils.ts ---