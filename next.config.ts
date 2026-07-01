import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app runs on the Bun runtime (it uses bun:sqlite). Next's in-build
  // TypeScript and ESLint steps run Bun's bundled tsc, which currently
  // segfaults under `--bun`. We gate types separately with `bun run typecheck`
  // (node tsc) instead, and let the Bun-run build handle bundling only.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
