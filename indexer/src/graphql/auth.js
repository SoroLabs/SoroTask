const jwt = require('jsonwebtoken');

// Secret for JWT - in production, this should be an environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

// Define standard roles
const ROLES = {
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  USER: 'USER',
  ANONYMOUS: 'ANONYMOUS'
};

// Hierarchy definition for deep field-level access control
const ROLE_HIERARCHY = {
  [ROLES.ADMIN]: 3,
  [ROLES.OPERATOR]: 2,
  [ROLES.USER]: 1,
  [ROLES.ANONYMOUS]: 0
};

/**
 * Validates a JWT token and returns the decoded payload.
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Generates context for GraphQL requests.
 * Extracts authorization header and assigns roles.
 */
function createContext({ req }) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    return { user: { role: ROLES.ANONYMOUS } };
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return { user: { role: ROLES.ANONYMOUS } };
  }

  return {
    user: {
      id: decoded.id,
      role: decoded.role || ROLES.USER,
      address: decoded.address
    }
  };
}

/**
 * Authorization helper to enforce required role levels.
 * Throws an error if the user's role is insufficient.
 */
function enforceRole(context, requiredRole) {
  const userRole = context?.user?.role || ROLES.ANONYMOUS;
  
  if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[requiredRole]) {
    throw new Error(`Unauthorized: Requires ${requiredRole} access level.`);
  }
}

/**
 * Field-level authorization wrapper.
 * Returns null or obfuscated data if access level is insufficient.
 */
function authField(requiredRole, resolverFunction) {
  return (parent, args, context, info) => {
    try {
      enforceRole(context, requiredRole);
      return resolverFunction(parent, args, context, info);
    } catch (err) {
      // In GraphQL, throwing here prevents the field from resolving,
      // but returning null allows the rest of the query to succeed.
      // Depending on strictness, we either throw or return null.
      throw new Error(`Field access denied: ${info.fieldName} requires ${requiredRole}`);
    }
  };
}

/**
 * Checks if the user is the creator/owner of a specific resource.
 */
function isOwner(context, creatorAddress) {
  return context?.user?.address === creatorAddress;
}

/**
 * Express middleware for REST JWT authentication.
 */
function expressJwtAuth(req, res, next) {
  const isPublicRoute =
    req.path === '/metrics' ||
    req.path === '/api/health' ||
    req.path === '/api-docs.json' ||
    req.path === '/api-docs' ||
    req.path.startsWith('/api-docs/');

  if (isPublicRoute) {
    req.user = { role: ROLES.ANONYMOUS };
    return next();
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    req.user = { role: ROLES.ANONYMOUS };
    return next();
  }

  const token = authHeader.replace('Bearer ', '');
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired JWT token',
    });
  }

  req.user = {
    id: decoded.id,
    role: decoded.role || ROLES.USER,
    address: decoded.address,
  };
  next();
}

/**
 * Express middleware to enforce minimum required role for REST routes.
 */
function requireRole(requiredRole) {
  return (req, res, next) => {
    const userRole = req.user?.role || ROLES.ANONYMOUS;
    if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[requiredRole]) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Requires ${requiredRole} access level`,
      });
    }
    next();
  };
}

module.exports = {
  ROLES,
  ROLE_HIERARCHY,
  JWT_SECRET,
  verifyToken,
  createContext,
  enforceRole,
  authField,
  isOwner,
  expressJwtAuth,
  requireRole,
};

