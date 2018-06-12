module.exports = {
  server: {
    host:
      (process.env.SERVER_SCHEMA || 'http') +
      `://${process.env.SERVER_HOST || 'localhost'}`,
    backendPort: process.env.SERVER_BACKEND_PORT || 3000,
    frontendPort: process.env.SERVER_FRONTEND_PORT || 3001,
    basePath: process.env.SERVER_BASE_PATH || '',
  },
  redis: {
    url: process.env.REDIS_URL || '',
    user: process.env.REDIS_USER || '',
    password: process.env.REDIS_PASSWORD || '',
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
  },
  email: {
    user: process.env.EMAIL_USER || 'ethense.test@gmail.com',
    password: process.env.EMAIL_PASSWORD || 'notethcerts',
  },
}
