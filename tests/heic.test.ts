import { afterEach, describe, expect, it, vi } from "vitest";

// mock 系统工具，避免测试依赖真实 heif-convert 二进制
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";

import { convertHeicToJpeg, isHeicDecodeError, isHeicExt } from "../src/heic.js";

describe("isHeicExt", () => {
  it("识别 heic/heif 扩展名（大小写无关）", () => {
    expect(isHeicExt("photo.heic")).toBe(true);
    expect(isHeicExt("photo.HEIF")).toBe(true);
    expect(isHeicExt("photo.jpg")).toBe(false);
    expect(isHeicExt("photo.png")).toBe(false);
    expect(isHeicExt("noext")).toBe(false);
  });
});

describe("isHeicDecodeError", () => {
  it("匹配 heif 解码器缺失错误", () => {
    expect(
      isHeicDecodeError(
        new Error(
          "source: bad seek to 3034646\nheif: Support for this compression format has not been built in (11.6003)",
        ),
      ),
    ).toBe(true);
    expect(isHeicDecodeError(new Error("heic: Invalid input"))).toBe(true);
  });

  it("不匹配无关错误", () => {
    expect(isHeicDecodeError(new Error("Input buffer has corrupt header"))).toBe(false);
    expect(isHeicDecodeError(new Error("network timeout"))).toBe(false);
  });
});

describe("convertHeicToJpeg", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("调用 heif-convert 并读回转出的 JPEG 字节", async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    vi.mocked(execFile).mockImplementation(
      // args = [inputPath, outputPath]；模拟 heif-convert 把 JPEG 写到 output
      // promisify 期望回调 (err, {stdout, stderr})
      ((_cmd: unknown, args: unknown[], cb: (err: Error | null, res?: { stdout: string; stderr: string }) => void) => {
        const outputPath = (args as string[])[1];
        writeFile(outputPath, fakeJpeg)
          .then(() => cb(null, { stdout: "", stderr: "" }))
          .catch((e) => cb(e));
        return undefined as never;
      }) as never,
    );

    const heicBytes = Buffer.from([0, 0, 0, 0x24, 0x66, 0x74, 0x79, 0x70]); // ftyp 头
    const result = await convertHeicToJpeg(heicBytes);

    expect(execFile).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(execFile).mock.calls[0][1] as string[];
    expect(callArgs[0]).toMatch(/input\.heic$/);
    expect(callArgs[1]).toMatch(/output\.jpg$/);
    expect(result).toEqual(fakeJpeg);
  });

  it("heif-convert 输出为空时抛错", async () => {
    vi.mocked(execFile).mockImplementation(
      // 不写任何输出文件→读回时为空
      ((_cmd: unknown, _args: unknown[], cb: (err: Error | null, res?: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: "", stderr: "" });
        return undefined as never;
      }) as never,
    );

    await expect(convertHeicToJpeg(Buffer.from([1, 2, 3]))).rejects.toThrow("heif-convert 未生成有效输出");
  });
});