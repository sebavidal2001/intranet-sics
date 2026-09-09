/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deploy su VM con PM2 + `next start` e node_modules presenti:
  // `output: standalone` (pensato per Docker) non serve e genera un warning
  // con `next start`. Rimosso per coerenza con la modalità di deploy reale.
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Il riconoscimento ottico delle fatture FedEx usa due pacchetti che non
    // si possono impacchettare: `@napi-rs/canvas` porta un binario nativo
    // (`.node`, che webpack non sa leggere e su cui la build si ferma) e
    // `tesseract.js` carica i suoi moduli WebAssembly a runtime. Restano
    // esterni e vengono richiesti dal `node_modules` sul server, che è come
    // il deploy sulla VM funziona già oggi.
    serverComponentsExternalPackages: ["@napi-rs/canvas", "tesseract.js"],
  },
  webpack(config, { isServer }) {
    // `serverComponentsExternalPackages` da solo non basta: l'import dinamico
    // dentro un route handler viene comunque tracciato da webpack, che arriva
    // al `.node` e si ferma. Dichiararli esterni qui è esplicito e vale per
    // tutto il codice server.
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals]),
        "@napi-rs/canvas",
        "tesseract.js",
      ].filter(Boolean);
    }
    return config;
  },
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
    // Content-Security-Policy in modalità Report-Only: non blocca nulla, ma
    // logga in console le violazioni. Serve a raccogliere le sorgenti reali
    // (script inline di Next, Supabase, immagini storage) prima di passare a
    // enforcing. Dopo qualche giorno senza violazioni legittime, rinominare
    // l'header in "Content-Security-Policy" per attivare il blocco.
    const supabaseHost = "*.supabase.co";
    const csp = [
      "default-src 'self'",
      // Next.js in produzione usa script con nonce/hash; 'unsafe-inline' resta
      // come fallback finché non si adotta lo strict-dynamic con nonce.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://${supabaseHost}`,
      "font-src 'self' data:",
      `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
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
