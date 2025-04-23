module.exports = {
  apps: [
    {
      name: "app1-server",
      script: "npx", // Use npx to potentially resolve path issues
      args: "react-router dev", // Run the command directly
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: "development", // Ensure development environment for dev server
      },
    },
    {
      name: "db-reset-scheduler",
      script: "./reset-scheduler.js",
      cwd: __dirname,
      watch: false,
      interpreter: "node",
      node_args: "-r dotenv/config", // Load .env file before running the script
      env: {
        NODE_ENV: "production", // Or 'development' depending on context
      },
    },
  ],
};
