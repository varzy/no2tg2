import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { logger } from './logger.ts';

const execFileAsync = promisify(execFile);

const HEIC_EXTS = new Set(['heic', 'heif']);

/** 判断扩展名是否为 HEIC/HEIF 容器格式。 */
export function isHeicExt(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return HEIC_EXTS.has(ext ?? '');
}

/**
 * 形如 "heif: ..." 或 "Support for this compression format has not been built in"
 * 的错误，说明 sharp 预编译的 libvips 未带 HEVC 解码插件，需回退系统工具转码。
 */
export function isHeicDecodeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /heif|heic|compression format.*not.*built/i.test(msg);
}

/**
 * 用系统工具将 HEIC 字节转码为 JPEG 字节。
 *
 * sharp 预编译的 libvips 出于专利/license 原因不含 HEVC 解码器，能识别 heic 容器
 * 却无法解码像素。这里回退到系统 heif-convert（libheif-examples，ubuntu: apt install
 * libheif-examples libde265），它自带 HEVC 解码。
 *
 * heif-convert 不支持写到 stdout，必须落临时文件：写入 input.heic → 转出 output.jpg
 * → 读回 → 清理临时目录。
 */
export async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'no2tg2-heic-'));
  try {
    const inputPath = join(dir, 'input.heic');
    const outputPath = join(dir, 'output.jpg');
    await writeFile(inputPath, buffer);

    // heif-convert <input> <output>，退出码 0 = 成功
    const { stdout, stderr } = await execFileAsync('heif-convert', [inputPath, outputPath]);
    logger.debug(
      { stdout: stdout.slice(0, 200), stderr: stderr.slice(0, 200) },
      'heif-convert 输出',
    );

    const { readFile, stat } = await import('node:fs/promises');
    const fileStat = await stat(outputPath).catch(() => null);
    if (!fileStat || fileStat.size === 0) {
      throw new Error('heif-convert 未生成有效输出');
    }
    const jpegBuffer = await readFile(outputPath);

    logger.info(
      { inputSize: buffer.length, outputSize: jpegBuffer.length },
      'HEIC 已通过 heif-convert 转为 JPEG',
    );
    return jpegBuffer;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
