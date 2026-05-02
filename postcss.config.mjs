/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    tailwindcss: { config: './tailwind.config.mjs' },
    autoprefixer: {},
  },
};

export default config;
