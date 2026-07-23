const buildId = Date.now().toString();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  generateBuildId: async () => buildId,
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId
  },
  allowedDevOrigins: ['192.168.86.32'],
};

module.exports = nextConfig;
