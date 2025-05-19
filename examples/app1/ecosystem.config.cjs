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
    {
      name: "db-reset-scheduler",
      script: "./reset-scheduler.js",
      cwd: __dirname,
      watch: false,
      interpreter: "node",
      node_args: "-r dotenv/config",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
