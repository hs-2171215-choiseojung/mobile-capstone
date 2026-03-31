/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com', // Google 프로필 이미지
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // Remotion 패키지는 네이티브 바이너리(.node)를 포함하므로 Next.js 번들링에서 제외
  experimental: {
    serverComponentsExternalPackages: [
      '@remotion/bundler',
      '@remotion/renderer',
      '@remotion/core',
      'remotion',
    ],
  },
}

module.exports = nextConfig
