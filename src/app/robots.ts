import type { MetadataRoute } from "next";
import { appBaseUrl } from "@/services/payments";

export default function robots(): MetadataRoute.Robots {
  const base = appBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private, transactional and tracking paths carry no public content.
        disallow: ["/api/", "/go/", "/radars", "/konts", "/ienakt", "/maksajums/", "/rezultati"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
