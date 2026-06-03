import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // HO 184: /feed renamed to /bills. Next preserves the query string
      // automatically, so /feed?mode=news&topics=… → /bills?mode=news&topics=…
      // Keeps the deployed URL + bookmarks alive.
      {
        source: "/feed",
        destination: "/bills",
        permanent: true,
      },
      {
        source: "/sponsors",
        destination: "/members",
        permanent: true,
      },
      {
        source: "/sponsors/:bioguideId",
        destination: "/members/:bioguideId",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
