const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Tasks CRUD API',
      version: '1.0.0',
      description: 'A simple in-memory tasks API'
    },
    servers: [{ url: 'http://localhost:3000' }]
  },
  apis: ['./routes/*.js']
};

module.exports = swaggerJsdoc(options);