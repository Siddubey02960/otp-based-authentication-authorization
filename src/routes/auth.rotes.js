const express = require('express');
const { generateOtp, verifyOtp } = require('../controllers/otp-controller');

const authRoutes = express.Router();

authRoutes.get('/generate-otp', generateOtp);
authRoutes.post('/verify-otp', verifyOtp);

module.exports= authRoutes;