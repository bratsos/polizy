// The database reset now runs in-process inside the server (see
// app/lib/db-reset.server.ts), so there is no separate scheduler process.
module.exports = {
  apps: [
    {
      name: "app1-server",
      script: "pnpm",
      args: "start",
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
