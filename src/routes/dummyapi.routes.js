const express = require('express');
const { protectedAction } = require('../controllers/api-controller');
const { checkClaims } = require('../middleware/auth-middleware');


const apiRoutes = express.Router();

apiRoutes.get('/protected-resource',checkClaims, protectedAction);

module.exports= apiRoutes ;