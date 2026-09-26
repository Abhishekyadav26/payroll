import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo-style layout: the real project root (contracts, state files)
  // lives one level up; silence the multi-lockfile workspace warning.
  outputFileTracingRoot: __dirname,
  // NOTE: Midnight SDK code is intentionally NOT bundled here. API routes
  // spawn root tsx scripts as child processes (see lib/payroll-server.ts),
  // because bundling duplicates wasm-backed runtime classes.
};

export default nextConfig;
