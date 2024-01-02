const assignClaims = async(userId) => {
  // Assume userClaims is a database
  const userClaims = {
    user1: ['read'],
    user2: ['read', 'write'],
  };

  return userClaims[userId] || [];
}

module.exports = { assignClaims };
