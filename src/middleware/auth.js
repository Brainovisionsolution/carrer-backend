import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'bv_super_secret_jwt_key_2026_careers_brainovision';

export function authenticateCandidate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. Valid candidate authentication token required.',
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'candidate') {
      return res.status(403).json({
        success: false,
        message: 'Invalid token type for candidate portal.',
      });
    }
    req.candidate = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired candidate session token.',
      error: err.message,
    });
  }
}

export function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. Administrator authorization required.',
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Administrative credentials required.',
      });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired administrator token.',
      error: err.message,
    });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin || !allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient administrative privileges.',
      });
    }
    next();
  };
}
