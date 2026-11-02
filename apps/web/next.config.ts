import type { NextConfig } from "next";

const api = process.env.JARVIS_API_URL || "http://127.0.0.1:8787";

const config: NextConfig = {
  // Proxy /api/* to the Jarvis server so the browser talks to one origin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default config;
