const { assignClaims } = require('../controllers/auth-controller');

const checkClaims= async (req, res, next) => {
  const userId = req.body.userId;
  req.claims = assignClaims(userId);
  next();
}

module.exports = { checkClaims };
