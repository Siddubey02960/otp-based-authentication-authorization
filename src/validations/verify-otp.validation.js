const Joi = require('joi');

module.exports = Joi.object({
    otp: Joi.number().required().label('OTP'),
    userId: Joi.string().uuid().required().label('User Id')
  });