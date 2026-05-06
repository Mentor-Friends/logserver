module.exports = {
  apps: [
    {
      name: 'logserver',
      script: './dist/server.js',
      cwd: __dirname,
      interpreter: 'node',
      node_args: '-r dotenv/config',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
