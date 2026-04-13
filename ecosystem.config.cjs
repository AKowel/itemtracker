module.exports = {
  apps: [
    {
      name: "itemtracker",
      script: "./server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3100
      }
    }
  ]
};
