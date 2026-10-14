import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  allowedDevOrigins: [
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
    '192.168.0.40',
    '192.168.0.40:3000',
    '192.168.0.49',
    '192.168.0.49:3000',
    '192.168.*',
    '*.loca.lt',
  ],
};

export default nextConfig;
