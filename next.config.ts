import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable dev indicators that show ONNX warnings
  devIndicators: false,
  // Turbopack is default in Next.js 16
  turbopack: {},
};

export default nextConfig;
