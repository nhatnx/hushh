/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    // Disable symlink resolution and filesystem caching to avoid
    // EISDIR errors from pnpm/Windows junction points during build.
    config.resolve.symlinks = false;
    config.cache = false;
    return config;
  },
};

module.exports = nextConfig;
