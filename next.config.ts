import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The MCP server and scripts import from lib/ directly; nothing there needs bundler tricks.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
  // Pin the workspace root so a parent-directory lockfile or git repo is never picked up.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
