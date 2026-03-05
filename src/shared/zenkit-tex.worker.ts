/// <reference lib="webworker" />

import ZenKitModuleFactory from "@kolarz3/zenkit";

type DecodeTexRequest = {
  id: number;
  type: "decodeTex";
  url: string;
};

type DecodeTexResponse =
  | {
      id: number;
      ok: true;
      width: number;
      height: number;
      rgba: ArrayBuffer;
      hasAlpha: boolean;
      resolvedUrl: string;
    }
  | {
      id: number;
      ok: false;
      error?: string;
    };

let zenKitPromise: Promise<any> | null = null;

function getCandidateTextureUrls(url: string): string[] {
  const out: string[] = [url];
  if (/_C\d+-C\.TEX$/i.test(url) && !/_C0-C\.TEX$/i.test(url)) {
    out.push(url.replace(/_C\d+(-C\.TEX)$/i, "_C0$1"));
  }
  if (!url.toUpperCase().endsWith("/DEFAULT-C.TEX")) {
    out.push("/TEXTURES/_COMPILED/DEFAULT-C.TEX");
  }
  return out;
}

async function getZenKit(): Promise<any> {
  if (!zenKitPromise) {
    zenKitPromise = (ZenKitModuleFactory as unknown as () => Promise<any>)();
  }
  return zenKitPromise;
}

function computeHasAlpha(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) return true;
  }
  return false;
}

async function decodeTex(url: string): Promise<DecodeTexResponse> {
  try {
    const zenKit = await getZenKit();
    const candidates = getCandidateTextureUrls(url);

    for (const candidateUrl of candidates) {
      let response: Response;
      try {
        response = await fetch(candidateUrl);
      } catch {
        continue;
      }
      if (!response.ok) continue;

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const zkTex = new zenKit.Texture();
      const ok = zkTex.loadFromArray(bytes);
      if (!ok || !ok.success) continue;

      const width = zkTex.width;
      const height = zkTex.height;
      const rgba = zkTex.asRgba8(0);
      if (!rgba) continue;

      const hasAlpha = computeHasAlpha(rgba);
      return {
        id: -1,
        ok: true,
        width,
        height,
        rgba: rgba.buffer.slice(0),
        hasAlpha,
        resolvedUrl: candidateUrl,
      };
    }

    return { id: -1, ok: false, error: "Texture not found or decode failed" };
  } catch (error) {
    return { id: -1, ok: false, error: String(error) };
  }
}

self.onmessage = async (event: MessageEvent<DecodeTexRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== "decodeTex") return;

  const result = await decodeTex(msg.url);
  const response: DecodeTexResponse = { ...result, id: msg.id };

  if (response.ok) {
    self.postMessage(response, [response.rgba]);
  } else {
    self.postMessage(response);
  }
};

export {};
