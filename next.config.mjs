/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for self-hosted VM deployment
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        // Supabase Storage: le URL pubbliche dei file caricati dagli utenti
        // provengono dal sottodominio del progetto Supabase
        // (es. <project-ref>.supabase.co). Il valore esatto dipende dalla
        // variabile NEXT_PUBLIC_SUPABASE_URL e non è noto a build time, quindi
        // si usa il wildcard *.supabase.co invece di ** per limitare il rischio.
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    serverComponentsExternalPackages: ["@react-pdf/renderer"],
  },
};

export default nextConfig;
