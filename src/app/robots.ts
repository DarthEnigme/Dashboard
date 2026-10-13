import type { MetadataRoute } from "next";

/** A private dashboard: crawlers are asked to stay out (pages also carry noindex). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
