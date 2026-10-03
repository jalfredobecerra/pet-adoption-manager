const request = require('supertest');
const session = require('express-session');

const { createApp } = require('../src/app');
const resources = require('../src/resources');

const ID = '507f1f77bcf86cd799439011';
const OTHER_ID = '507f1f77bcf86cd799439012';

let app;
let models;
let currentUser;
let connected;
let passport;

function query(result) {
  const chain = {};

  for (const method of [
    'select',
    'sort',
    'skip',
    'limit'
  ]) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }

  chain.lean = jest.fn().mockResolvedValue(result);

  return chain;
}

beforeEach(() => {
  currentUser = null;
  connected = true;

  models = Object.fromEntries(
    Object.keys(resources).map((resource) => [
      resource,
      {
        find: jest.fn(() => query([{ _id: ID }])),
        findOne: jest.fn(() => query({ _id: ID })),
        create: jest.fn()
      }
    ])
  );

  passport = {
    initialize: () => (req, res, next) => {
      req.logout = (done) => {
        currentUser = null;
        done();
      };

      next();
    },

    session: () => (req, res, next) => {
      req.user = currentUser;
      req.isAuthenticated = () => Boolean(currentUser);
      next();
    },

    authenticate: jest.fn((strategy, options = {}) => {
      return (req, res, next) => {
        if (options.scope) {
          return res.redirect('https://accounts.google.com/mock');
        }

        if (req.query.state === 'invalid') {
          return next(
            Object.assign(new Error('Invalid OAuth state.'), {
              status: 403
            })
          );
        }

        if (req.query.code === 'denied') {
          return next(
            Object.assign(new Error('Authentication failed.'), {
              status: 401
            })
          );
        }

        next();
      };
    })
  };

  app = createApp({
    models,
    passport,
    store: new session.MemoryStore(),
    secret: 'test-only-secret-at-least-32-characters',
    dbReady: () => connected
  });
});

function signIn(role = 'admin') {
  currentUser = {
    _id: ID,
    displayName: 'Julian Becerra',
    email: 'julian@example.invalid',
    role,
    shelterId: OTHER_ID
  };
}

describe.each(Object.keys(resources))('%s GET routes', (resource) => {
  beforeEach(() => {
    signIn();
  });

  test('lists records', async () => {
    const response = await request(app)
      .get(`/api/${resource}`)
      .expect(200);

    expect(response.body).toEqual({
      data: [{ _id: ID }],
      page: 1,
      limit: 20
    });
  });

  test('returns an empty list', async () => {
    models[resource].find.mockReturnValue(query([]));

    const response = await request(app)
      .get(`/api/${resource}`)
      .expect(200);

    expect(response.body.data).toEqual([]);
  });

  test('gets one record', async () => {
    const response = await request(app)
      .get(`/api/${resource}/${ID}`)
      .expect(200);

    expect(response.body.data._id).toBe(ID);
  });

  test('rejects malformed IDs', async () => {
    await request(app)
      .get(`/api/${resource}/invalid`)
      .expect(400);

    expect(models[resource].findOne).not.toHaveBeenCalled();
  });

  test('returns 404 for missing records', async () => {
    models[resource].findOne.mockReturnValue(query(null));

    await request(app)
      .get(`/api/${resource}/${ID}`)
      .expect(404);
  });

  test('rejects invalid pagination', async () => {
    await request(app)
      .get(`/api/${resource}?page=0`)
      .expect(400);
  });

  test('handles list database failures', async () => {
    const failed = query(null);

    failed.lean.mockRejectedValue(new Error('Private DB details'));
    models[resource].find.mockReturnValue(failed);

    const response = await request(app)
      .get(`/api/${resource}`)
      .expect(500);

    expect(response.body.error.message)
      .toBe('An unexpected server error occurred.');
  });

  test('handles single-record database failures', async () => {
    const failed = query(null);

    failed.lean.mockRejectedValue(new Error('Private DB details'));
    models[resource].findOne.mockReturnValue(failed);

    await request(app)
      .get(`/api/${resource}/${ID}`)
      .expect(500);
  });
});

test('pet reads are public', async () => {
  await request(app).get('/api/pets').expect(200);
  await request(app).get(`/api/pets/${ID}`).expect(200);
});

test('shelter reads are public', async () => {
  await request(app).get('/api/shelters').expect(200);
  await request(app).get(`/api/shelters/${ID}`).expect(200);
});

test.each(['users', 'applications'])(
  '%s reads require sign-in',
  async (resource) => {
    await request(app).get(`/api/${resource}`).expect(401);
    await request(app).get(`/api/${resource}/${ID}`).expect(401);
  }
);

test('adopters cannot list all users', async () => {
  signIn('adopter');

  await request(app).get('/api/users').expect(403);
});

test('adopters can read their own user profile', async () => {
  signIn('adopter');

  await request(app).get(`/api/users/${ID}`).expect(200);
});

test('adopters cannot read another user profile', async () => {
  signIn('adopter');

  await request(app).get(`/api/users/${OTHER_ID}`).expect(403);
});

test('application lists are scoped to the adopter', async () => {
  signIn('adopter');

  await request(app).get('/api/applications').expect(200);

  expect(models.applications.find)
    .toHaveBeenCalledWith({ adopterId: ID });
});

test('individual applications are scoped to the adopter', async () => {
  signIn('adopter');

  await request(app)
    .get(`/api/applications/${OTHER_ID}`)
    .expect(200);

  expect(models.applications.findOne).toHaveBeenCalledWith({
    adopterId: ID,
    _id: OTHER_ID
  });
});

test('shelter staff reads are scoped to their shelter', async () => {
  signIn('shelterStaff');

  await request(app).get('/api/applications').expect(200);

  expect(models.applications.find)
    .toHaveBeenCalledWith({ shelterId: OTHER_ID });
});

test('inaccessible applications return 404', async () => {
  signIn('adopter');
  models.applications.findOne.mockReturnValue(query(null));

  await request(app)
    .get(`/api/applications/${OTHER_ID}`)
    .expect(404);
});

test('pet filters are translated into safe query fields', async () => {
  await request(app)
    .get(`/api/pets?species=dog&status=available&shelterId=${ID}`)
    .expect(200);

  expect(models.pets.find).toHaveBeenCalledWith({
    species: 'dog',
    adoptionStatus: 'available',
    shelterId: ID
  });
});

test.each([
  '?species=dragon',
  '?status=unknown',
  '?shelterId=invalid',
  '?unexpected=value'
])('invalid pet query %s returns 400', async (queryString) => {
  await request(app).get(`/api/pets${queryString}`).expect(400);
});

test('GET /auth/google starts an OAuth redirect', async () => {
  const response = await request(app)
    .get('/auth/google')
    .expect(302);

  expect(response.headers.location)
    .toBe('https://accounts.google.com/mock');

  expect(passport.authenticate).toHaveBeenCalledWith(
    'google',
    expect.objectContaining({
      scope: ['openid', 'profile', 'email']
    })
  );
});

test('OAuth callback success redirects to documentation', async () => {
  const response = await request(app)
    .get('/auth/google/callback?code=valid&state=valid')
    .expect(302);

  expect(response.headers.location).toBe('/api-docs');
});

test('OAuth callback rejects missing parameters', async () => {
  await request(app)
    .get('/auth/google/callback')
    .expect(400);
});

test('OAuth cancellation returns 401', async () => {
  await request(app)
    .get('/auth/google/callback?error=access_denied')
    .expect(401);
});

test('OAuth middleware state rejection is handled', async () => {
  await request(app)
    .get('/auth/google/callback?code=valid&state=invalid')
    .expect(403);
});

test('OAuth middleware authentication failure is handled', async () => {
  await request(app)
    .get('/auth/google/callback?code=denied&state=valid')
    .expect(401);
});

test('GET /auth/me requires sign-in', async () => {
  await request(app).get('/auth/me').expect(401);
});

test('GET /auth/me returns the signed-in profile', async () => {
  signIn('adopter');

  const response = await request(app).get('/auth/me').expect(200);

  expect(response.body.data._id).toBe(ID);
  expect(response.body.needsOnboarding).toBe(false);
  expect(response.body.data.providerId).toBeUndefined();
});

test('GET /auth/me identifies a new OAuth user', async () => {
  currentUser = {
    oauthProvider: 'google',
    providerId: 'google-test-id',
    displayName: 'Julian Becerra',
    email: 'julian@example.invalid'
  };

  const response = await request(app).get('/auth/me').expect(200);

  expect(response.body.needsOnboarding).toBe(true);
});

test('GET /auth/csrf requires sign-in', async () => {
  await request(app).get('/auth/csrf').expect(401);
});

test('GET /auth/csrf returns a session-bound token', async () => {
  signIn('adopter');

  const agent = request.agent(app);
  const first = await agent.get('/auth/csrf').expect(200);
  const second = await agent.get('/auth/csrf').expect(200);

  expect(first.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
  expect(second.body.csrfToken).toBe(first.body.csrfToken);
});

test('GET /health reports a connected database', async () => {
  const response = await request(app).get('/health').expect(200);

  expect(response.body.database).toBe('connected');
});

test('GET /health returns 503 when disconnected', async () => {
  connected = false;

  await request(app).get('/health').expect(503);
});

test('GET / redirects to Swagger', async () => {
  const response = await request(app).get('/').expect(302);

  expect(response.headers.location).toBe('/api-docs');
});

test('GET /api-docs serves Swagger UI', async () => {
  const response = await request(app)
    .get('/api-docs')
    .redirects(2)
    .expect(200);

  expect(response.text).toContain('swagger-ui');
});

test('GET /api-docs.json documents CRUD for every collection', async () => {
  const response = await request(app)
    .get('/api-docs.json')
    .expect(200);

  for (const [resource, settings] of Object.entries(resources)) {
    const collection = response.body.paths[`/api/${resource}`];
    const item = response.body.paths[
      `/api/${resource}/{${settings.idParam}}`
    ];

    expect(collection.get).toBeDefined();
    expect(collection.post).toBeDefined();
    expect(item.get).toBeDefined();
    expect(item.put).toBeDefined();
    expect(item.delete).toBeDefined();
  }
});

test('new profile creation validates CSRF and request fields', async () => {
  currentUser = {
    oauthProvider: 'google',
    providerId: 'google-test-id',
    displayName: 'Julian Becerra',
    email: 'julian@example.invalid'
  };

  await request(app)
    .post('/api/users')
    .send({ displayName: 'Julian Becerra' })
    .expect(403);

  const agent = request.agent(app);
  const tokenResponse = await agent.get('/auth/csrf').expect(200);
  const token = tokenResponse.body.csrfToken;

  await agent
    .post('/api/users')
    .set('X-CSRF-Token', token)
    .send({ displayName: 'Julian Becerra', role: 'admin' })
    .expect(400);

  models.users.create.mockResolvedValue({
    _id: ID,
    displayName: 'Julian Becerra',
    email: 'julian@example.invalid',
    role: 'adopter'
  });

  await agent
    .post('/api/users')
    .set('X-CSRF-Token', token)
    .send({ displayName: 'Julian Becerra' })
    .expect(201);

  expect(models.users.create).toHaveBeenCalledWith(
    expect.objectContaining({
      providerId: 'google-test-id',
      role: 'adopter'
    })
  );
});