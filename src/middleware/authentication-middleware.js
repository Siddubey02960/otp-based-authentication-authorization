const speakeasy = require('speakeasy');
const { JsonDB } = require('node-json-db')
const { Config } = require('node-json-db/dist/lib/JsonDBConfig')

const verifyOtpValidation = require('../validations/verify-otp.validation');

const db = new JsonDB(new Config('user-token',true, false, '/'));

const authenticateOTP = async(req, res, next) => {
 try{
    const { userId, otp } = req.body;

    await verifyOtpValidation.validateAsync(req.body);
  
    const dbPath = `/user-token/${userId}`;
    const user = await db.getData(dbPath)

    const verified = speakeasy.totp.verify({
      secret: user.temp_secret || user.secret,
      encoding: 'base32',
      token: otp,
    });
  
    if (verified) {
      next();
    } else {
      res.status(401).json({ message: 'Authentication failed. Invalid OTP.' });
    }
}catch(error) {
    if (error.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
    }
    return next(error);
}

}

module.exports = { authenticateOTP };
