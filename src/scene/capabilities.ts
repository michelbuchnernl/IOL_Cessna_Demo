import type { ExperienceMode } from "../types/experience";

export interface XrCapabilities {
  ar: boolean;
  vr: boolean;
  fallback: true;
  touch: boolean;
  ipad: boolean;
}

export async function detectXrCapabilities(): Promise<XrCapabilities> {
  const xr = navigator.xr;
  const touch = navigator.maxTouchPoints > 0;
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  const ipad =
    /iPad/.test(userAgent) ||
    (platform === "MacIntel" && touch) ||
    (/Macintosh/.test(userAgent) && touch);

  if (!xr) {
    return { ar: false, vr: false, fallback: true, touch, ipad };
  }

  const [ar, vr] = await Promise.all([
    xr.isSessionSupported("immersive-ar").catch(() => false),
    xr.isSessionSupported("immersive-vr").catch(() => false)
  ]);

  return { ar, vr, fallback: true, touch, ipad };
}

export function getBestMode(capabilities: XrCapabilities, allowedModes: ExperienceMode[]): ExperienceMode {
  if (allowedModes.includes("ar") && capabilities.ar) {
    return "ar";
  }
  if (allowedModes.includes("vr") && capabilities.vr) {
    return "vr";
  }
  return "fallback";
}
