function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const expected = process.env.KEEPER_ADMIN_TOKEN;

  if (!expected || token !== expected) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = {
  requireAdminAuth,
};
