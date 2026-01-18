import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    'localhost:3000',
    '127.0.0.1:3000',
    '172.25.16.198:3000',
  ],
};

export default config;
