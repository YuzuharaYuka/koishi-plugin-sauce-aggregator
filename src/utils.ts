// --- START OF FILE src/utils.ts ---
import { Buffer } from 'buffer';
import { decodeJPEGFromStream, decodePNGFromStream, encodeJPEGToStream, encodePNGToStream, make } from 'pureimage';
import { Readable, PassThrough } from 'stream';
import { Logger, h } from 'koishi';

const logger = new Logger('sauce-aggregator:utils');

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Safely extracts plain text content from message elements.
 * @param elements The message elements array.
 * @returns The concatenated, unescaped plain text.
 */
export function extractPlainText(elements: h[]): string {
    if (!elements) return '';
    return h.select(elements, 'text').map(e => e.attrs.content).join('').trim();
}

export function getImageTypeFromUrl(url: string): string {
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return 'image/jpeg';
  }
}

export function detectImageType(buffer: Buffer): 'jpeg' | 'png' | null {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
    return null;
}
  
export async function preprocessImage(buffer: Buffer, maxSizeInMB = 4): Promise<Buffer> {
    const ONE_MB = 1024 * 1024;
    if (buffer.length <= maxSizeInMB * ONE_MB) return buffer;
  
    logger.info(`图片体积 (${(buffer.length / ONE_MB).toFixed(2)}MB) 超出 ${maxSizeInMB}MB，正在压缩...`);
    
    try {
      const imageType = detectImageType(buffer);
      if (!imageType) {
        logger.warn(`[preprocess] 不支持的图片格式，无法压缩。将使用原图。`);
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
      logger.info(`[preprocess] 图片压缩完成，新体积: ${(finalBuffer.length / ONE_MB).toFixed(2)}MB`);
      return finalBuffer;
  
    } catch (error) {
      logger.error('图片压缩失败:', error);
      return buffer;
    }
}

export function getImageUrlAndName(session: any, text: string): { url: string; name: string } {
    let url: string;
    let imgElement: h;
    let textToParse = text;

    // Priority 1: Image element in the current message
    imgElement = session.elements?.find(e => e.type === 'img');
    url = imgElement?.attrs.src;
    
    // Priority 2: If no image element, check if the current message text is a URL
    if (!url) {
        const rawCurrentText = extractPlainText(session.elements);
        if (rawCurrentText) {
            textToParse = rawCurrentText;
        }
    }
    
    // Priority 3: If still no URL and it's a reply, check the quoted message
    if (!url && session.quote) {
        imgElement = session.quote.elements?.find(e => e.type === 'img');
        url = imgElement?.attrs.src;
        // Priority 4: If quoted message has no image, get its raw text to parse
        if (!url) {
            textToParse = extractPlainText(session.quote.elements);
        }
    }

    // Priority 5: Parse the determined text for a URL if no image element was ever found
    if (!url && textToParse) {
        try {
            const potentialUrl = textToParse.trim().split(/\s+/)[0];
            new URL(potentialUrl);
            if (potentialUrl.startsWith('http')) {
                url = potentialUrl;
            }
        } catch (_) {}
    }

    if (!url) return { url: null, name: null };
    
    const rawName = (imgElement?.attrs.file || url.split('/').pop().split('?')[0]) || 'image.jpg';
    const name = rawName.replace(/[\r\n"']+/g, '');

    if (session.app?.config.debug) {
      logger.info(`[Debug] Parsed image URL: ${url}`);
    }
    return { url, name };
}