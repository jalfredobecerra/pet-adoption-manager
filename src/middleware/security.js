const crypto = require('node:crypto');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireIdentity(req, res, next) {
  if (!req.isAuthenticated()) {
    return next(httpError(401, 'Sign in with Google first.'));
  }

  next();
}

function csrfToken(req, res) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  res.json({ csrfToken: req.session.csrfToken });
}

function requireCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const supplied = req.get('X-CSRF-Token');

  if (
    typeof expected !== 'string' ||
    typeof supplied !== 'string' ||
    expected.length !== supplied.length
  ) {
    return next(httpError(403, 'Invalid CSRF token.'));
  }

  const valid = crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(supplied, 'utf8')
  );

  if (!valid) {
    return next(httpError(403, 'Invalid CSRF token.'));
  }

  next();
}

function publicUser(user) {
  return {
    _id: user._id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    shelterId: user.shelterId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let status = err.status || 500;
  let message = err.message;

  if (
    err.name === 'ValidationError' ||
    err.name === 'CastError'
  ) {
    status = 400;
    message = 'Invalid request data.';
  }

  if (err.code === 11000) {
    status = 409;
    message = 'A matching record already exists.';
  }

  if (status >= 500) {
    message = 'An unexpected server error occurred.';
    console.error('Request failed:', err.name);
  }

  res.status(status).json({
    error: {
      status,
      message
    }
  });
}

module.exports = {
  httpError,
  requireIdentity,
  csrfToken,
  requireCsrf,
  publicUser,
  errorHandler
};