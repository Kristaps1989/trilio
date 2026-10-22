import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { IMAGE_HOSTS } from "./src/db/stores";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// CSP is set per request in src/proxy.ts (nonce-based). Everything else that
// does not vary per request lives here.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Product photos from the stores' image hosts only (src/db/stores.ts); nothing else is proxied.
    remotePatterns: IMAGE_HOSTS.map((hostname) => ({ protocol: "https", hostname })),
    // Shop photos rarely change; a day keeps the optimiser from re-fetching them on every view.
    minimumCacheTTL: 86_400,
  },
  // The radar became the wishlist (owner, 20 Oct 2026): old links land there.
  async redirects() {
    return [
      { source: "/radars", destination: "/velmju-saraksts", permanent: false },
      { source: "/radars/:path*", destination: "/velmju-saraksts", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
