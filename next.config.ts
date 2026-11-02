import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: { cpus: 2 },
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
