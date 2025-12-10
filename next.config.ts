import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["voice.irelate.ai", "ricks-mini.local"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
  // Suppress ONNX runtime warnings that look like errors
  devIndicators: false,
};

export default nextConfig;
