module.exports = {
  apps: [{
    name: 'rooted-api',
    script: 'dist/src/server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    }
  }]
};
