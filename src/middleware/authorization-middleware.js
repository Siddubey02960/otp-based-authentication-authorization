const { assignClaims } = require('../controllers/auth-controller');

const claimAuthorizationMiddleware = async (req, res, next) => {
  const userId = req.body.userId;
  const requiredClaim = 'write'; // Hardcoded write permission.
  
  const userClaims = await assignClaims(userId);

  if (userClaims.includes(requiredClaim)) {
    next();
  } else {
    res.status(403).json({ message: 'Access denied' });
  }
}

module.exports = { claimAuthorizationMiddleware };

