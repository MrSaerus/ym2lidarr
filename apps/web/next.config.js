/** @type {import('next').NextConfig} */
const PORT_API = process.env.PORT_API || 'http://localhost:4000';
const nextConfig = {
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,

  async rewrites() {
    return [{ source: '/:path*', destination: `${PORT_API}/:path*` }];
  }
};

module.exports = nextConfig;