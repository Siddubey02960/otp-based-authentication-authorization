const express = require('express');

const apiRoutes = express.Router();

const otpRoutes = require('./otp.routes');
const authRoutes = require('./auth.rotes');
const dummyapiRoutes = require('./dummyapi.routes');

apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/otp', otpRoutes);
apiRoutes.use('/dummyapi',dummyapiRoutes);

module.exports = apiRoutes;

