import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.EMPS_LOCAL_PREVIEW === 'true' ? '.next-remote-preview' : '.next',
};
export default nextConfig;
