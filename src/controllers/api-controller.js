const protectedAction= async(req, res,next) => {
    try{
          res.json({ message: 'Able to access protected resource successfully.' });
    }catch(error){
        return next(err);
    }
}

module.exports = { protectedAction };
