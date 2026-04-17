import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  async headers() {
    return [
      {
        // Only the WebContainer popup route is cross-origin-isolated.
        // Main app routes stay header-free so Sandpack's cross-origin
        // bundler iframe isn't blocked by COEP.
        source: "/sandbox",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
