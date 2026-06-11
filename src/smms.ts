import { config } from './config.ts';
import { logger } from './logger.ts';

const SMMS_BASE_URL = 'https://s.ee/api/v1/file';

export interface SmmsUploadSuccess {
  success: true;
  code: string;
  RequestId: string;
  message: string;
  data: {
    width: number;
    height: number;
    filename: string;
    storename: string;
    size: number;
    path: string;
    hash: string;
    url: string;
    delete: string;
    page: string;
  };
}

export interface SmmsUploadRepeat {
  success: false;
  code: 'image_repeated';
  images: string;
}

export interface SmmsUploadError {
  success: false;
  code: string;
  message: string;
}

export type SmmsUploadResult = SmmsUploadSuccess | SmmsUploadRepeat | SmmsUploadError;

const SM_MS_DOMAINS = ['cdn.sa.net', 'sm.ms', 'i.see.you'];

export function isSmmsUrl(url: string): boolean {
  return SM_MS_DOMAINS.some((domain) => url.includes(domain));
}

export function generateFileName(url: string, blockId: string): string {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  const originalName = pathParts[pathParts.length - 1];
  const extension = originalName.includes('.') ? originalName.split('.').pop()! : 'jpg';

  const timestamp = Date.now();
  return `no2tg2_${blockId}_${timestamp}.${extension}`;
}

export function getSmmsUrl(result: SmmsUploadResult): string | null {
  if (result.success) {
    return result.data.url;
  }
  if (result.code === 'image_repeated') {
    return (result as SmmsUploadRepeat).images;
  }
  return null;
}

export async function smmsUpload(
  fileBuffer: Buffer,
  fileName: string,
): Promise<SmmsUploadResult> {
  const formData = new FormData();
  formData.append('smfile', new Blob([new Uint8Array(fileBuffer)]), fileName);

  const response = await fetch(`${SMMS_BASE_URL}/upload`, {
    method: 'POST',
    body: formData,
    headers: { Authorization: config.smms.apiToken },
    cache: 'no-cache' as RequestCache,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => 'unable to read response body');
    logger.error(
      { status: response.status, body: body.slice(0, 500) },
      'SM.MS API 返回非 200 状态码',
    );
    throw new Error(`SM.MS API 请求失败（HTTP ${response.status}）`);
  }

  const result = (await response.json()) as SmmsUploadResult;

  if (!result.success && result.code !== 'image_repeated') {
    logger.warn({ fileName, result }, 'SM.MS 上传返回错误');
  }

  return result;
}
