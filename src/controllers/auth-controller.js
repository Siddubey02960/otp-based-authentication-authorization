const assignClaims = async(userId) => {
  const userClaims = {
    user1: ['read'],
    user2: ['read', 'write'],
  };

  return userClaims[userId] || [];
}

module.exports = { assignClaims };
