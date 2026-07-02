module.exports = {
  apps: [
    {
      name: "vibe-trading-admin",
      cwd: "/opt/Vibe-Trading/admin",
      script: ".next/standalone/server.js",
      env: {
        HOSTNAME: "0.0.0.0",
        PORT: "8787",
        VIBE_API_URL: "http://127.0.0.1:8899",
        NODE_ENV: "production",
      },
    },
  ],
};
