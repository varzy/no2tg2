import { describe, expect, it, vi } from "vitest";

import { createTelegramProxyAgent, sendToChannel } from "../src/telegram.js";
import type { TelegramApi } from "../src/telegram.js";

vi.mock("../src/compress.js", () => ({
  compressImage: vi.fn(async (buffer: Buffer) => buffer),
}));

function createApiMock(): TelegramApi {
  return {
    sendMessage: vi.fn(async () => ({} as never)),
    sendPhoto: vi.fn(async () => ({} as never)),
    sendMediaGroup: vi.fn(async () => ([] as never))
  };
}

function createFetchMock(): (typeof fetch) & ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as (typeof fetch) & ReturnType<typeof vi.fn>;
}

describe("sendToChannel", () => {
  it("0 张图时使用 sendMessage", async () => {
    const api = createApiMock();
    const fetchMock = createFetchMock();
    await sendToChannel("hello", [], api, fetchMock);

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendPhoto).not.toHaveBeenCalled();
    expect(api.sendMediaGroup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("1 张图时下载后使用 sendPhoto", async () => {
    const api = createApiMock();
    const fetchMock = createFetchMock();
    await sendToChannel("hello", ["https://img/1.jpg"], api, fetchMock);

    expect(api.sendPhoto).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.sendMediaGroup).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("https://img/1.jpg");

    const photoArg = vi.mocked(api.sendPhoto).mock.calls[0]?.[1] as { source: Buffer };
    expect(Buffer.isBuffer(photoArg.source)).toBe(true);
  });

  it("2-10 张图时下载后使用 sendMediaGroup 且首图带 caption", async () => {
    const api = createApiMock();
    const fetchMock = createFetchMock();
    const imageUrls = ["https://img/1.jpg", "https://img/2.jpg"];
    await sendToChannel("hello", imageUrls, api, fetchMock);

    expect(api.sendMediaGroup).toHaveBeenCalledTimes(1);
    const media = vi.mocked(api.sendMediaGroup).mock.calls[0]?.[1];
    expect(media?.[0]).toMatchObject({ caption: "hello", parse_mode: "MarkdownV2" });
    expect(media?.[1]).not.toHaveProperty("caption");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(media?.every((item) => typeof item === "object" && "media" in item && typeof item.media === "object")).toBe(true);
  });

  it("超过 10 张图时报错", async () => {
    const api = createApiMock();
    const fetchMock = createFetchMock();
    const imageUrls = Array.from({ length: 11 }, (_, idx) => `https://img/${idx}.jpg`);

    await expect(sendToChannel("hello", imageUrls, api, fetchMock)).rejects.toThrow("图片数量超过 Telegram 限制");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("下载失败时抛出错误", async () => {
    const api = createApiMock();
    const fetchMock = vi.fn(async () => new Response("", { status: 403 })) as typeof fetch;

    await expect(sendToChannel("hello", ["https://img/1.jpg"], api, fetchMock)).rejects.toThrow("下载图片失败");
    expect(api.sendPhoto).not.toHaveBeenCalled();
  });
});

describe("createTelegramProxyAgent", () => {
  it("没有代理环境变量时返回 null", () => {
    const agent = createTelegramProxyAgent({});
    expect(agent).toBeNull();
  });

  it("优先使用 https_proxy", () => {
    const agent = createTelegramProxyAgent({
      https_proxy: "http://127.0.0.1:6152",
      http_proxy: "http://127.0.0.1:6151",
      all_proxy: "socks5://127.0.0.1:6153"
    });
    expect(agent).toBeTruthy();
  });
});
