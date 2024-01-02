const { assignClaims } = require('./auth-controller');

const protectedAction= async(req, res,next) => {
    try{
        const requiredClaim = 'write';
        if (req.claims.includes(requiredClaim)) {
          res.json({ message: 'Action performed successfully.' });
        } else {
          res.status(403).json({ message: 'Access denied.' });
        }
    }catch(error){
        return next(err);
    }
}

module.exports = { protectedAction };
