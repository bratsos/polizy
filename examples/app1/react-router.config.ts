import type { Config } from "@react-router/dev/config";

// SPA mode: there is no server. Each visitor's database (a real Postgres, via
// PGlite) lives in their own browser, and `clientLoader`/`clientAction` run
// there too. The build is fully static — deploy it to any CDN/static host.
export default {
  ssr: false,
} satisfies Config;
