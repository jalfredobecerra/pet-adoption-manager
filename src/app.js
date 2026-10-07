const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');

const resources = require('./resources');

const {
  createReadControllers
} = require('./controllers/read');

const {
  createWriteControllers
} = require('./controllers/write');

const {
  createWeek6Controllers
} = require('./controllers/week6');

const {
  httpError,
  handleErrors,
  requireIdentity,
  requireProfile,
  csrfToken,
  requireCsrf,
  publicUser,
  errorHandler
} = require('./middleware/security');

const buildOpenApi = require('../docs/week6');

function createApp({
  models,
  passport,
  store,
  secret,
  production = false,
  dbReady = () => false
}) {
  const app = express();

  app.disable('x-powered-by');

  if (production) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );

  app.use(express.json({ limit: '100kb' }));

  app.use(
    session({
      name: 'pa.sid',
      secret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: production,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/'
      }
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  app.get(
    '/',
    handleErrors((req, res) => {
      res.redirect('/api-docs');
    })
  );

  app.get(
    '/health',
    handleErrors((req, res) => {
      const connected = dbReady();

      res.status(connected ? 200 : 503).json({
        status: connected ? 'ok' : 'unavailable',
        database: connected
          ? 'connected'
          : 'disconnected'
      });
    })
  );

  app.get(
    '/auth/google',
    passport.authenticate('google', {
      scope: ['openid', 'profile', 'email']
    })
  );

  app.get(
    '/auth/google/callback',
    handleErrors((req, res, next) => {
      if (req.query.error) {
        throw httpError(
          401,
          'Google sign-in was canceled.'
        );
      }

      if (
        typeof req.query.code !== 'string' ||
        typeof req.query.state !== 'string'
      ) {
        throw httpError(
          400,
          'Invalid OAuth callback.'
        );
      }

      next();
    }),
    passport.authenticate('google', {
      failWithError: true
    }),
    handleErrors((req, res) => {
      res.redirect('/api-docs');
    })
  );

  app.get(
    '/auth/me',
    requireIdentity,
    handleErrors((req, res) => {
      res.json({
        data: publicUser(req.user),
        needsOnboarding: !req.user._id
      });
    })
  );

  app.get(
    '/auth/csrf',
    requireIdentity,
    handleErrors(csrfToken)
  );

  app.post(
    '/auth/logout',
    requireIdentity,
    requireCsrf,
    handleErrors(async (req, res) => {
      await new Promise((resolve, reject) => {
        req.logout((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      await new Promise((resolve, reject) => {
        req.session.destroy((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      res.clearCookie('pa.sid', {
        httpOnly: true,
        secure: production,
        sameSite: 'lax',
        path: '/'
      });

      res.status(204).end();
    })
  );

  const reads = createReadControllers(models);

  for (
    const [resource, settings]
    of Object.entries(resources)
  ) {
    app.get(
      `/api/${resource}`,
      handleErrors(reads[resource].list)
    );

    app.get(
      `/api/${resource}/:${settings.idParam}`,
      handleErrors(reads[resource].single)
    );
  }

  const week6 = createWeek6Controllers(models);

  const writes = {
    ...createWriteControllers(models),
    ...week6
  };

  for (
    const [resource, settings]
    of Object.entries(resources)
  ) {
    // New Google identities can onboard before having a local user ID.
    app.post(
      `/api/${resource}`,
      resource === 'users'
        ? requireIdentity
        : requireProfile,
      requireCsrf,
      writes[resource].create
    );

    app.put(
      `/api/${resource}/:${settings.idParam}`,
      requireProfile,
      requireCsrf,
      writes[resource].update
    );

    app.delete(
      `/api/${resource}/:${settings.idParam}`,
      requireProfile,
      requireCsrf,
      writes[resource].remove
    );
  }

  const specification = buildOpenApi();

  app.get(
    '/api-docs.json',
    handleErrors((req, res) => {
      res.json(specification);
    })
  );

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(specification, {
      customSiteTitle: 'Pet Adoption Manager API',
      swaggerOptions: {
        withCredentials: true,
        persistAuthorization: false
      }
    })
  );

  app.use((req, res, next) => {
    next(httpError(404, 'Route not found.'));
  });

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };