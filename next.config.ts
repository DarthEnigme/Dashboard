import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["dockerode", "ssh2", "cpu-features", "systeminformation", "net-snmp"],
  images: { unoptimized: true },
};

export default nextConfig;
