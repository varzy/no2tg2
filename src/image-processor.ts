import type { BlockObjectResponse } from '@notionhq/client';

import { compressImage } from './compress.ts';
import { logger } from './logger.ts';
import { notionClient } from './notion.ts';
import { generateFileName, getSmmsUrl, isSmmsUrl, smmsUpload } from './smms.ts';

export interface ImageProcessingStats {
  total: number;
  processed: number;
  skipped: number;
  errors: number;
}

export async function processPageImages(pageId: string): Promise<ImageProcessingStats> {
  const stats: ImageProcessingStats = { total: 0, processed: 0, skipped: 0, errors: 0 };
  await processBlocks(pageId, stats);
  return stats;
}

async function processBlocks(
  blockId: string,
  stats: ImageProcessingStats,
  startCursor?: string,
): Promise<void> {
  const response = await notionClient.blocks.children.list({
    block_id: blockId,
    page_size: 100,
    start_cursor: startCursor,
  });

  for (const block of response.results) {
    if (!('type' in block)) continue;

    if (block.type === 'image') {
      stats.total++;
      await processImageBlock(block as BlockObjectResponse, stats);
    }

    if (block.has_children) {
      await processBlocks(block.id, stats);
    }
  }

  if (response.has_more && response.next_cursor) {
    await processBlocks(blockId, stats, response.next_cursor);
  }
}

const SM_MS_API_DELAY_MS = 100;

async function processImageBlock(
  block: BlockObjectResponse,
  stats: ImageProcessingStats,
): Promise<void> {
  if (block.type !== 'image') return;

  try {
    const imageBlock = block.image;
    let imageUrl: string;
    let needsUpload = false;

    if (imageBlock.type === 'file') {
      imageUrl = imageBlock.file.url;
      needsUpload = true;
    } else if (imageBlock.type === 'external') {
      imageUrl = imageBlock.external.url;
      needsUpload = !isSmmsUrl(imageUrl);
    } else {
      stats.skipped++;
      return;
    }

    if (!needsUpload) {
      stats.skipped++;
      return;
    }

    logger.info({ blockId: block.id, imageUrl }, '正在下载图片...');
    const downloadResponse = await fetch(imageUrl);
    if (!downloadResponse.ok) {
      throw new Error(`下载图片失败：${imageUrl}（HTTP ${downloadResponse.status}）`);
    }

    const rawArrayBuffer = await downloadResponse.arrayBuffer();
    const rawBuffer = Buffer.from(rawArrayBuffer);

    const fileName = generateFileName(imageUrl, block.id);
    const imageBuffer =
      (await compressImage(rawBuffer, fileName).catch(() => null)) ?? rawBuffer;

    logger.info({ blockId: block.id, fileName }, '正在上传到 SM.MS...');
    const uploadResult = await smmsUpload(imageBuffer, fileName);
    const smmsUrl = getSmmsUrl(uploadResult);
    if (!smmsUrl) {
      const message =
        !uploadResult.success && 'message' in uploadResult
          ? uploadResult.message
          : 'unknown error';
      throw new Error(`SM.MS 上传失败: ${message}`);
    }

    logger.info({ blockId: block.id, smmsUrl }, '正在更新 Notion block...');
    await notionClient.blocks.update({
      block_id: block.id,
      image: { external: { url: smmsUrl } },
    });

    stats.processed++;
    logger.info({ blockId: block.id, smmsUrl }, '图片已上传并更新');

    await new Promise((resolve) => setTimeout(resolve, SM_MS_API_DELAY_MS));
  } catch (err) {
    stats.errors++;
    logger.error({ blockId: block.id, err }, '图片处理失败');
  }
}
