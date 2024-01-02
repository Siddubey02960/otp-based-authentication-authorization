const express = require('express');
const { protectedAction } = require('../controllers/api-controller');
const { claimAuthorizationMiddleware } = require('../middleware/authorization-middleware');
const { authenticateOTP } = require('../middleware/authentication-middleware');

const apiRoutes = express.Router();

apiRoutes.get('/protected-resource',[authenticateOTP,claimAuthorizationMiddleware, protectedAction]);

module.exports= apiRoutes;