import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
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
