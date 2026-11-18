import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["dockerode", "ssh2", "cpu-features", "systeminformation", "net-snmp"],
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Other sites can't frame the dashboard (and its admin actions).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // The OAuth consent page: never inside a frame, not even ours (a framed "Allow" is clickjacking bait).
        source: "/oauth/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
    ];
  },
};

export default nextConfig;
