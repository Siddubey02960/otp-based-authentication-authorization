const speakeasy = require('speakeasy');
const uuid = require('uuid');
const { JsonDB } = require('node-json-db')
const { Config } = require('node-json-db/dist/lib/JsonDBConfig')

const verifyOtpValidation = require('../validations/verify-otp.validation');

const db = new JsonDB(new Config('user-token',true, false, '/'));

const generateOtp = async(req, res, next) => {
    const userId = uuid.v4();
    try{
        const dbPath = `/user-token/${userId}`;
        const secret = await speakeasy.generateSecret({ length: 12 });
        const otpUri = await speakeasy.otpauthURL({
          secret: secret.base32,
          label: 'Assignment',
        });
        db.push(dbPath,{ userId,temp_secret: secret.base32 });
        res.status(200).json({ secret: secret.base32, otpUri });
    } catch(err){
        res.status(500).json({message: "Error in generating otp"});
    }   
}

const verifyOtp = async(req,res,next) => {
    try{
        const { userId, otp } = req.body;

        await verifyOtpValidation.validateAsync(req.body);

        const dbPath = `/user-token/${userId}`;
        const user = await db.getData(dbPath)

        const verified = await speakeasy.totp.verify({
          secret: user.temp_secret || user.secret,
          encoding: 'base32',
          token: otp,
        });
        if(!verified){
            return res.status(400).json({ error: 'Invalid OTP' });
        }
        db.push(dbPath,{ userId,secret: user.temp_secret });
        res.status(200).json({ verified });
    }catch(error){
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({message: "Error in verifing otp"});
    }
}

module.exports ={
    generateOtp,
    verifyOtp,
}