import { describe, expect, it } from "vitest";

import { stripJpegSecondaryImages } from "../src/compress.js";

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** 构造一个带长度字段的 JPEG 段（APPn/COM/DQT/SOFn 等）。 */
function segment(marker: number, body: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2, 0);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
}

/** 构造 SOS：段头 + 若干熵编码字节（含 FF00 填充与 RSTn）+ EOI。 */
function sosWithEntropy(): Buffer {
  const header = segment(0xda, Buffer.from([0x00, 0x01, 0x02])); // SOS 段头
  const entropy = Buffer.from([
    0x12, 0x34, 0xff, 0x00, // FF00 填充字节，属熵编码数据
    0x56, 0xff, 0xd0, // RST0，仍属熵编码流
    0x78,
  ]);
  return Buffer.concat([header, entropy, EOI]);
}

/** 主图 = SOI + APP1(含 Exif 缩略图片段，整体按长度跳过) + 摘要段 + SOS+熵+EOI。 */
function primaryImage(): Buffer {
  const app1 = segment(0xe1, Buffer.from([0x45, 0x78, 0x69, 0x66, 0xaa, 0xbb])); // 含 "Exif"
  const sof = segment(0xc0, Buffer.from([0x08, 0x01, 0x01]));
  return Buffer.concat([SOI, app1, sof, sosWithEntropy()]);
}

describe("stripJpegSecondaryImages", () => {
  it("剥离主图 EOI 之后的次级图片（Ultra HDR gain map）", () => {
    const primary = primaryImage();
    const gainMap = Buffer.concat([SOI, segment(0xe1, Buffer.from([0x99, 0x88]), EOI)]);
    const multi = Buffer.concat([primary, gainMap]);

    const stripped = stripJpegSecondaryImages(multi);

    expect(stripped.length).toBe(primary.length);
    expect(stripped.equals(primary)).toBe(true);
  });

  it("单图 JPEG（EOI 即末尾）原样返回", () => {
    const primary = primaryImage();
    expect(stripJpegSecondaryImages(primary).equals(primary)).toBe(true);
  });

  it("非 JPEG（如 PNG）原样返回", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(stripJpegSecondaryImages(png).equals(png)).toBe(true);
  });

  it("过短或非法缓冲原样返回", () => {
    const tiny = Buffer.from([0x01, 0x02]);
    expect(stripJpegSecondaryImages(tiny).equals(tiny)).toBe(true);

    const noEoi = Buffer.concat([SOI, segment(0xe1, Buffer.from([0x1, 0x2]))]);
    expect(stripJpegSecondaryImages(noEoi).equals(noEoi)).toBe(true);
  });
});