const express = require('express');

const apiRoutes = express.Router();

const otpRoutes = require('./otp.routes');
const dummyapiRoutes = require('./dummyapi.routes');

apiRoutes.use('/otp', otpRoutes);
apiRoutes.use('/dummyapi',dummyapiRoutes);

module.exports = apiRoutes;

