/** @type {import('next').NextConfig} */
const nextConfig = {
  // libsodium-wrappers uses WASM — keep it server-side only
  serverExternalPackages: ['libsodium-wrappers'],
  images: {
    remotePatterns: [{ hostname: 'avatars.githubusercontent.com' }],
  },
};

export default nextConfig;
