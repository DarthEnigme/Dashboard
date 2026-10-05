"use client";

import { useEffect } from "react";
import { accentFromPixels } from "@/lib/theme";

/** Derive --accent from the wallpaper. Images that refuse CORS keep the server-rendered accent. */
export function AutoAccent({ image }: { image: string }) {
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 48;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 48, 48);
        const color = accentFromPixels(ctx.getImageData(0, 0, 48, 48).data);
        if (color) document.documentElement.style.setProperty("--accent", color);
      } catch {
        // tainted canvas
      }
    };
    img.src = image;
  }, [image]);
  return null;
}
