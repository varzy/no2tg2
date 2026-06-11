import sharp from 'sharp';

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 80;
const PNG_QUALITY = 80;

export async function compressImage(buffer: Buffer, filename: string): Promise<Buffer> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const ext = filename.split('.').pop()?.toLowerCase();

  // Resize only if the image exceeds max dimension
  if (
    metadata.width &&
    metadata.height &&
    (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION)
  ) {
    image.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }

  switch (ext) {
    case 'png':
      return image.png({ quality: PNG_QUALITY }).toBuffer();
    case 'webp':
      return image.webp({ quality: JPEG_QUALITY }).toBuffer();
    case 'gif':
      // Don't compress gif, sharp can't handle animated gifs well
      return buffer;
    default:
      return image.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  }
}
