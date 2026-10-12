import sharp from 'sharp';

import { logger } from './logger.ts';

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 80;
const PNG_QUALITY = 80;

/**
 * 从 JPEG 字节中剥离 MPF 关联的次级图片（如 iPhone Ultra HDR 的 gain map）。
 *
 * Ultra HDR JPEG 在主图 EOI 之后追加一张 gain map。部分 libvips 构建在处理带
 * gain map 的 JPEG 时会走 libheif 代码路径，触发「iref box 引用数超过安全限制」
 * 之类的错误导致解码失败（observed on sharp 0.35.3 / ubuntu-latest）。
 *
 * 剥离后只保留主图，libvips 仅按 JPEG 解码，输出仍是标准 SDR JPEG——gain map 仅
 * 用于 HDR 显示，我们本就重新编码为 SDR，丢弃它无损画质。
 *
 * 解析方式：按 JPEG 段标记逐段跳过（含 Exif 缩略图所在 APP1 段，整体按长度跳过），
 * 直到 SOS 后的熵编码数据首个非填充标记；遇到主图 EOI 即截断其后所有次级图片。
 * 非多图 JPEG（EOI 即文件末尾）原样返回；非 JPEG 一律原样返回。
 */
export function stripJpegSecondaryImages(buffer: Buffer): Buffer {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;

  let offset = 2; // 跳过 SOI
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];

    // 填充字节 FF00 与 TEM(01) 无长度字段
    if (marker === 0x00 || marker === 0x01) {
      offset += 2;
      continue;
    }
    // RSTn(D0-D7) 独立标记，无长度
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    // EOI(D9)：主图结束，其后若有数据即为次级图片，截断
    if (marker === 0xd9) {
      const end = offset + 2;
      return end >= buffer.length ? buffer : buffer.subarray(0, end);
    }
    // SOS(DA)：段头之后是熵编码数据，扫描到下一个非填充标记（通常为 EOI）
    if (marker === 0xda) {
      const segLen = buffer.readUInt16BE(offset + 2);
      offset += 2 + segLen; // 跳过 SOS 段头，进入熵编码数据
      while (offset + 1 < buffer.length) {
        if (buffer[offset] === 0xff && buffer[offset + 1] !== 0x00) {
          const m = buffer[offset + 1];
          // RSTn 仍属熵编码流，越过继续扫描
          if (m >= 0xd0 && m <= 0xd7) {
            offset += 2;
            continue;
          }
          break;
        }
        offset++;
      }
      continue;
    }
    // 其余段(APPn/COM/DQT/DHT/SOFn...)：读 2 字节长度后整体跳过
    if (offset + 3 >= buffer.length) return buffer;
    const segLen = buffer.readUInt16BE(offset + 2);
    offset += 2 + segLen;
  }
  return buffer;
}

export async function compressImage(buffer: Buffer, filename: string): Promise<Buffer> {
  const image = sharp(stripJpegSecondaryImages(buffer));
  const metadata = await image.metadata();
  const ext = filename.split('.').pop()?.toLowerCase();

  // Apply EXIF orientation (e.g. phone photos taken in portrait) so the correct
  // orientation is baked into the pixels. Otherwise sharp strips the EXIF tag on
  // re-encode while leaving the pixels un-rotated, making the image appear sideways.
  image.rotate();

  // Resize only if the image exceeds max dimension
  if (
    metadata.width &&
    metadata.height &&
    (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION)
  ) {
    image.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }

  let output: Buffer;
  switch (ext) {
    case 'png':
      output = await image.png({ quality: PNG_QUALITY }).toBuffer();
      break;
    case 'webp':
      output = await image.webp({ quality: JPEG_QUALITY }).toBuffer();
      break;
    case 'gif':
      // Don't compress gif, sharp can't handle animated gifs well
      output = buffer;
      break;
    default:
      output = await image.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  }

  // 集中记录压缩结果，覆盖 R2 处理与 Telegram 上传两条路径。format/dims/尺寸是
  // 图片问题的首要诊断信息（如 Ultra HDR gain map、解码失败、尺寸异常等）。
  logger.info(
    {
      filename,
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      inputSize: buffer.length,
      outputSize: output.length,
    },
    '图片压缩完成',
  );

  return output;
}
