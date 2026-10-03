const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const { z } = require('zod');

const resources = require('./resources');

const {
  createReadControllers
} = require('./controllers/read');

const {
  createWriteControllers
} = require('./controllers/write');

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

const buildOpenApi = require('../docs/openapi');

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
        database: connected ? 'connected' : 'disconnected'
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
        throw httpError(401, 'Google sign-in was canceled.');
      }

      if (
        typeof req.query.code !== 'string' ||
        typeof req.query.state !== 'string'
      ) {
        throw httpError(400, 'Invalid OAuth callback.');
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
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      await new Promise((resolve, reject) => {
        req.session.destroy((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
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

  for (const [resource, settings] of Object.entries(resources)) {
    app.get(
      `/api/${resource}`,
      handleErrors(reads[resource].list)
    );

    app.get(
      `/api/${resource}/:${settings.idParam}`,
      handleErrors(reads[resource].single)
    );
  }

  const profileInput = z
    .object({
      displayName: z
        .string()
        .trim()
        .min(2)
        .max(80)
        .optional()
    })
    .strict();

  app.post(
    '/api/users',
    requireIdentity,
    requireCsrf,
    handleErrors(async (req, res) => {
      if (req.user._id) {
        throw httpError(409, 'Your profile already exists.');
      }

      const parsed = profileInput.safeParse(req.body ?? {});

      if (!parsed.success) {
        throw httpError(
          400,
          'Use only displayName, containing 2 to 80 characters.'
        );
      }

      const user = await models.users.create({
        oauthProvider: req.user.oauthProvider,
        providerId: req.user.providerId,
        email: req.user.email,
        displayName:
          parsed.data.displayName || req.user.displayName,
        role: 'adopter'
      });

      res.status(201).json({
        data: publicUser(user)
      });
    })
  );

  const writes = createWriteControllers(models);

  for (const resource of ['shelters', 'pets']) {
    const settings = resources[resource];

    app.post(
      `/api/${resource}`,
      requireProfile,
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

  const plannedWrite = handleErrors((req, res) => {
    res.status(501).json({
      error: {
        status: 501,
        message: 'This operation is planned for Week 6.'
      }
    });
  });

  // These remaining collections are outside the W05 two-collection CRUD scope.
  for (const resource of ['users', 'applications']) {
    const settings = resources[resource];

    if (resource === 'applications') {
      app.post(
        `/api/${resource}`,
        requireProfile,
        requireCsrf,
        plannedWrite
      );
    }

    app.put(
      `/api/${resource}/:${settings.idParam}`,
      requireProfile,
      requireCsrf,
      plannedWrite
    );

    app.delete(
      `/api/${resource}/:${settings.idParam}`,
      requireProfile,
      requireCsrf,
      plannedWrite
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