// 图片预处理
//
// 搜图引擎对上传图片有各自的限制，最严格的是搜图bot酱（宽度不得超过 2000 像素）；
// IQDB 限制 8MB，SauceNAO / Trace.moe 对大图也会做服务端缩放。
// 因此上传前统一把图片压到「最长边 ≤ maxEdge、体积 ≤ maxSizeMB」，既满足站点限制，
// 也减少上传耗时与引擎处理时间。
//
// 只使用纯 JS / WASM，不引入 sharp、@napi-rs/canvas 这类原生库：
// 插件市场会把依赖原生二进制处理库的插件标记为不安全。
// JPEG / PNG 由 pureimage 解码，WebP 由 @cwasm/webp（libwebp 的 WASM 构建）解码；
// pureimage 自带的 drawImage 缩放很慢（2000px 约 2.3s），这里改用自写的
// 面积平均（box）重采样，实测同一张图整体处理约 0.8s。

import { Buffer } from 'buffer'
import { Readable, PassThrough } from 'stream'
import { Logger } from 'koishi'

const logger = new Logger('sauce-aggregator')

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | null

export interface ImageInfo {
  format: ImageFormat
  width: number
  height: number
}

export interface ImageLimits {
  /** 最长边上限（像素），0 表示不限制 */
  maxEdge?: number
  /** 体积上限（MB），0 表示不限制 */
  maxSizeMB?: number
  /** 重新编码时的 JPEG 质量 */
  quality?: number
  /** 日志用的来源标识，如引擎名 */
  label?: string
}

export interface PreparedImage {
  buffer: Buffer
  /** 是否发生了缩放或重新编码（文件名/扩展名需要随之调整） */
  changed: boolean
  info: ImageInfo | null
}

const DEFAULT_MAX_EDGE = 2000
const DEFAULT_MAX_SIZE_MB = 2
const DEFAULT_QUALITY = 90
/** pureimage 解码后的 RGBA 内存约为像素数 × 4 字节，超过该值不再处理，避免占满内存 */
const MAX_DECODE_PIXELS = 32_000_000

/** 读取图片格式与尺寸（只解析文件头，不解码像素） */
export function readImageInfo(buffer: Buffer): ImageInfo | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }

  // GIF87a / GIF89a
  if (buffer.toString('ascii', 0, 3) === 'GIF') {
    return { format: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }

  // BMP
  if (buffer.toString('ascii', 0, 2) === 'BM' && buffer.length >= 26) {
    return { format: 'bmp', width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) }
  }

  // WebP: RIFF....WEBP
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16)
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const b = buffer.readUInt32LE(21)
      return { format: 'webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X' && buffer.length >= 30) {
      const w = buffer.readUIntLE(24, 3) + 1
      const h = buffer.readUIntLE(27, 3) + 1
      return { format: 'webp', width: w, height: h }
    }
    return { format: 'webp', width: 0, height: 0 }
  }

  // JPEG: 扫描 SOF 标记
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) {
        i++
        continue
      }
      const marker = buffer[i + 1]
      // SOF0..SOF15（排除 DHT / JPG / DAC）
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) }
      }
      const length = buffer.readUInt16BE(i + 2)
      if (length < 2) break
      i += 2 + length
    }
    return { format: 'jpeg', width: 0, height: 0 }
  }

  return null
}

function toMegabytes(bytes: number): number {
  return bytes / 1024 / 1024
}

function needsProcess(info: ImageInfo | null, size: number, maxEdge: number, maxBytes: number): boolean {
  if (!info) return false
  if (maxEdge > 0 && (info.width > maxEdge || info.height > maxEdge)) return true
  if (maxBytes > 0 && size > maxBytes) return true
  return false
}

/** pureimage / ImageData 的位图结构（只声明用到的字段） */
interface Bitmap {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/**
 * 面积平均（box）重采样。
 *
 * 对每个目标像素取对应源矩形内所有像素的加权平均；alpha 统一合成到白底，
 * 避免透明 PNG 转 JPEG 后出现黑边。源图比目标小或相等时按 1:1 处理（只做合成）。
 * 相比 pureimage 的 drawImage 逐像素采样，这个实现只遍历一次源像素，快得多。
 */
function resizeBitmap(src: Bitmap, dstWidth: number, dstHeight: number, make: (w: number, h: number) => Bitmap): Bitmap {
  const srcWidth = src.width
  const srcHeight = src.height
  const srcData = src.data
  const dst = make(dstWidth, dstHeight)
  const dstData = dst.data

  const xRatio = srcWidth / dstWidth
  const yRatio = srcHeight / dstHeight

  for (let y = 0; y < dstHeight; y++) {
    const yStart = Math.floor(y * yRatio)
    const yEnd = Math.min(srcHeight, Math.max(yStart + 1, Math.floor((y + 1) * yRatio)))

    for (let x = 0; x < dstWidth; x++) {
      const xStart = Math.floor(x * xRatio)
      const xEnd = Math.min(srcWidth, Math.max(xStart + 1, Math.floor((x + 1) * xRatio)))

      let r = 0
      let g = 0
      let b = 0
      let samples = 0

      for (let sy = yStart; sy < yEnd; sy++) {
        let index = (sy * srcWidth + xStart) * 4
        for (let sx = xStart; sx < xEnd; sx++) {
          const alpha = srcData[index + 3]
          // 预乘 alpha，并合成到白底
          r += srcData[index] * alpha + 255 * (255 - alpha)
          g += srcData[index + 1] * alpha + 255 * (255 - alpha)
          b += srcData[index + 2] * alpha + 255 * (255 - alpha)
          samples++
          index += 4
        }
      }

      const out = (y * dstWidth + x) * 4
      const divisor = Math.max(1, samples) * 255
      dstData[out] = Math.round(r / divisor)
      dstData[out + 1] = Math.round(g / divisor)
      dstData[out + 2] = Math.round(b / divisor)
      dstData[out + 3] = 255
    }
  }

  return dst
}

/** 把整张图合成到白底（尺寸不变时使用） */
function flattenWhite(image: Bitmap): void {
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha === 255) continue
    const inverse = 255 - alpha
    data[i] = Math.round((data[i] * alpha + 255 * inverse) / 255)
    data[i + 1] = Math.round((data[i + 1] * alpha + 255 * inverse) / 255)
    data[i + 2] = Math.round((data[i + 2] * alpha + 255 * inverse) / 255)
    data[i + 3] = 255
  }
}

/** 把 Bitmap 编码为 JPEG，返回 Buffer */
async function encodeJpeg(
  image: Bitmap,
  encodeJPEGToStream: (canvas: any, out: any, quality?: number) => any,
  quality: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const passThrough = new PassThrough()
    passThrough.on('data', (chunk: Buffer) => chunks.push(chunk))
    passThrough.on('end', () => resolve(Buffer.concat(chunks)))
    passThrough.on('error', reject)
    Promise.resolve(encodeJPEGToStream(image, passThrough, quality)).catch(reject)
  })
}

/**
 * 按限制处理图片：只在超出 maxEdge / maxSizeMB 时才解码重编码。
 * 处理失败或缺少解码能力时返回原图，不阻断搜索。
 */
export async function prepareImage(buffer: Buffer, limits: ImageLimits = {}): Promise<PreparedImage> {
  const maxEdge = limits.maxEdge ?? DEFAULT_MAX_EDGE
  const maxSizeMB = limits.maxSizeMB ?? DEFAULT_MAX_SIZE_MB
  const quality = limits.quality ?? DEFAULT_QUALITY
  const label = limits.label ? `[${limits.label}] ` : ''
  const maxBytes = maxSizeMB > 0 ? maxSizeMB * 1024 * 1024 : 0

  const info = readImageInfo(buffer)
  const unchanged: PreparedImage = { buffer, changed: false, info }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return unchanged
  if (!needsProcess(info, buffer.length, maxEdge, maxBytes)) return { buffer, changed: false, info }

  // 纯 JS 解码的内存开销与像素数成正比，超大图直接放弃处理
  if (info && info.width * info.height > MAX_DECODE_PIXELS) {
    logger.warn(`${label}图片像素过多 (${info.width}x${info.height})，跳过处理以避免占用过多内存`)
    return unchanged
  }

  // 可解码的格式：JPEG / PNG 走 pureimage，WebP 走 WASM 解码器
  if (info?.format !== 'jpeg' && info?.format !== 'png' && info?.format !== 'webp') {
    logger.warn(`${label}无法解码 ${info?.format ?? '该格式'}，将使用原图`)
    return unchanged
  }

  logger.debug(
    `${label}图片 ${info.width}x${info.height} ${toMegabytes(buffer.length).toFixed(2)}MB，` +
    `按 ${maxEdge > 0 ? `${maxEdge}px` : '不限尺寸'} / ${maxSizeMB > 0 ? `${maxSizeMB}MB` : '不限体积'} 处理`
  )

  const startedAt = Date.now()

  try {
    const { decodeJPEGFromStream, decodePNGFromStream, encodeJPEGToStream, make } = await import('pureimage')
    let source: Bitmap
    if (info.format === 'webp') {
      const webp: any = await import('@cwasm/webp')
      const decode = webp.decode ?? webp.default?.decode
      if (typeof decode !== 'function') throw new Error('@cwasm/webp 未导出 decode')
      source = decode(buffer)
    } else {
      const stream = Readable.from(buffer)
      source = info.format === 'jpeg'
        ? await decodeJPEGFromStream(stream)
        : await decodePNGFromStream(stream)
    }

    if (!source?.width || !source?.height || !source.data) {
      logger.warn(`${label}图片解码结果无效，将使用原图`)
      return unchanged
    }

    const ratio = maxEdge > 0 ? Math.min(maxEdge / source.width, maxEdge / source.height, 1) : 1
    const width = Math.max(1, Math.round(source.width * ratio))
    const height = Math.max(1, Math.round(source.height * ratio))

    let processed: Bitmap
    if (width === source.width && height === source.height) {
      // 只压体积：不做缩放，仅合成白底
      flattenWhite(source)
      processed = source
    } else {
      processed = resizeBitmap(source, width, height, make)
    }

    // 体积仍超标时逐级降低质量（最多再试两次）
    let currentQuality = quality
    let output = await encodeJpeg(processed, encodeJPEGToStream, currentQuality)
    for (let attempt = 0; attempt < 2 && maxBytes > 0 && output.length > maxBytes && currentQuality > 60; attempt++) {
      currentQuality = Math.max(60, currentQuality - 15)
      output = await encodeJpeg(processed, encodeJPEGToStream, currentQuality)
    }

    if (!output.length) return unchanged

    const after = readImageInfo(output)
    logger.info(
      `${label}处理完成 ${after?.width}x${after?.height} ${toMegabytes(output.length).toFixed(2)}MB，` +
      `耗时 ${Date.now() - startedAt}ms`
    )
    return {
      buffer: output,
      changed: true,
      info: after ?? { format: 'jpeg', width, height },
    }
  } catch (error) {
    logger.warn(`${label}图片处理失败，将使用原图:`, error)
    return unchanged
  }
}

/** 仅保证尺寸不超过 maxEdge（用于引擎侧的硬性限制，已合规时零开销） */
export async function ensureImageWithin(buffer: Buffer, maxEdge: number, limits: ImageLimits = {}): Promise<PreparedImage> {
  if (maxEdge <= 0) return { buffer, changed: false, info: readImageInfo(buffer) }

  const info = readImageInfo(buffer)
  const unchanged: PreparedImage = { buffer, changed: false, info }
  if (info && info.width <= maxEdge && info.height <= maxEdge) return unchanged

  return prepareImage(buffer, { ...limits, maxEdge, maxSizeMB: limits.maxSizeMB ?? 0 })
}
