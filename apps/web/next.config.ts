import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@ats/shared'],
  webpack: (config, { dev }) => {
    // Windows: default file watchers often miss events or lock .next; dev then 500s or exits.
    if (dev && process.platform === 'win32') {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules/**', '**/.git/**'],
      };
    }
    return config;
  },
};

export default nextConfig;
