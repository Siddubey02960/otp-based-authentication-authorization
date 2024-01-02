const express = require('express');
const { generateOtp, verifyOtp } = require('../controllers/otp-controller');

const otpRoutes = express.Router();

otpRoutes.get('/generate-otp', generateOtp);
otpRoutes.post('/verify-otp', verifyOtp);

module.exports= otpRoutes;