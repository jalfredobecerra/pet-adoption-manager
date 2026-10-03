const crypto = require('node:crypto');

function httpError(status, message, details) {
  return Object.assign(new Error(message), {
    status,
    details
  });
}

function handleErrors(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function requireIdentity(req, res, next) {
  if (!req.isAuthenticated()) {
    return next(httpError(401, 'Sign in with Google first.'));
  }

  next();
}

function requireProfile(req, res, next) {
  if (!req.isAuthenticated()) {
    return next(httpError(401, 'Sign in with Google first.'));
  }

  if (!req.user._id) {
    return next(httpError(403, 'Complete your profile first.'));
  }

  next();
}

function csrfToken(req, res) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto
      .randomBytes(32)
      .toString('hex');
  }

  res.json({
    csrfToken: req.session.csrfToken
  });
}

function requireCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const supplied = req.get('X-CSRF-Token');

  if (
    typeof expected !== 'string' ||
    typeof supplied !== 'string'
  ) {
    return next(httpError(403, 'Invalid CSRF token.'));
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
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

  const candidate = Number(err.status || err.statusCode);

  let status =
    candidate >= 400 && candidate <= 599
      ? candidate
      : 500;

  let message = err.message || 'Request failed.';
  let details = err.details;

  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON request body.';
    details = undefined;
  }

  if (
    err.name === 'ValidationError' ||
    err.name === 'CastError'
  ) {
    status = 400;
    message = 'Invalid request data.';
    details = undefined;
  }

  if (err.code === 11000) {
    status = 409;
    message = 'A matching record already exists.';
    details = undefined;
  }

  if (status >= 500) {
    message = 'An unexpected server error occurred.';
    details = undefined;
    console.error('Request failed:', err.name);
  }

  res.status(status).json({
    error: {
      status,
      message,
      ...(details ? { details } : {})
    }
  });
}

module.exports = {
  httpError,
  handleErrors,
  requireIdentity,
  requireProfile,
  csrfToken,
  requireCsrf,
  publicUser,
  errorHandler
};