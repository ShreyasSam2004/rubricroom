import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "unpdf"],
  poweredByHeader: false,
  // Keep the dev-only Next.js badge off the sidebar footer.
  devIndicators: { position: "bottom-right" },
  // Migrations are applied at runtime on first DB connection, so ship the SQL with every function.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  images: {
    // Remote images are rendered with plain <img> tags; nothing is proxied through /_next/image.
    unoptimized: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
