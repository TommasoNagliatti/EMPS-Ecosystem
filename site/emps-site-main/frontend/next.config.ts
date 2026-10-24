import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: process.env.EMPS_LOCAL_PREVIEW === 'true' && process.env.EMPS_PREVIEW_HOST
    ? [process.env.EMPS_PREVIEW_HOST] : [],
  distDir: process.env.EMPS_LOCAL_PREVIEW === 'true'
    ? (process.env.EMPS_LOCAL_OPTIMIZED === 'true' ? '.next-local-optimized' : '.next-remote-preview') : '.next',
  ...(process.env.EMPS_LOCAL_OPTIMIZED === 'true' ? { experimental: { cpus: 2 } } : {}),
};
export default nextConfig;
