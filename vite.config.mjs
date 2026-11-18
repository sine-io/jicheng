import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
import {mapApi} from './worker/index.js';

// Some hosted preview containers do not expose interface enumeration.
// Vite only needs this to format its development-server URLs.
const readInterfaces = os.networkInterfaces;
os.networkInterfaces = function () {
  try {
    return readInterfaces();
  } catch (error) {
    if (error?.code !== "ERR_SYSTEM_ERROR") throw error;
    return { lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }] };
  }
};

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), {
    name: 'local-map-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/maps/') && !req.url?.startsWith('/_AMapService')) return next();
        try {
          const response = await mapApi(new Request(new URL(req.url, 'http://localhost'), {method: req.method}), process.env);
          if (!response) return next();
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {res.writeHead(502, {'Content-Type': 'application/json'}); res.end('{"error":"MAP_UNAVAILABLE"}');}
      });
    },
  }],
});
