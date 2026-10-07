const request = require('supertest');
const session = require('express-session');
const { createApp } = require('../src/app');

const USER = '507f1f77bcf86cd799439010';
const OTHER = '507f1f77bcf86cd799439020';
const SHELTER = '507f1f77bcf86cd799439011';
const PET = '507f1f77bcf86cd799439012';
const APPLICATION = '507f1f77bcf86cd799439013';

const body = {
  petId: PET,
  contactPhone: '555-0101',
  housingType: 'house',
  hasOtherPets: false,
  motivation: 'I can provide a loving and suitable home.'
};

let app;
let models;
let currentUser;
let agent;
let token;
let record;

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

beforeEach(async () => {
  currentUser = {
    _id: USER,
    role: 'adopter',
    displayName: 'Demo User',
    email: 'demo@example.com',
    shelterId: SHELTER
  };

  record = {
    _id: APPLICATION,
    ...body,
    adopterId: USER,
    shelterId: SHELTER,
    status: 'submitted'
  };

  models = {};

  for (const name of [
    'users',
    'shelters',
    'pets',
    'applications'
  ]) {
    models[name] = {
      find: jest.fn(() => query([])),
      findOne: jest.fn(() => query(null)),
      exists: jest.fn().mockResolvedValue(null),

      create: jest.fn(async (input) => ({
        _id: APPLICATION,
        ...input
      })),

      findOneAndUpdate: jest.fn(
        async (filter, update) => ({
          _id: filter._id,
          ...update.$set
        })
      ),

      findOneAndDelete: jest.fn().mockResolvedValue({
        _id: APPLICATION
      })
    };
  }

  models.users.findOne.mockImplementation(
    () => query({ ...currentUser })
  );

  models.users.exists.mockResolvedValue({
    _id: USER
  });

  models.shelters.exists.mockResolvedValue({
    _id: SHELTER
  });

  models.pets.findOne.mockImplementation(
    () => query({
      _id: PET,
      shelterId: SHELTER,
      adoptionStatus: 'available'
    })
  );

  models.applications.findOne.mockImplementation(
    () => query(record)
  );

  const passport = {
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

    authenticate: () => (req, res, next) => next()
  };

  app = createApp({
    models,
    passport,
    store: new session.MemoryStore(),
    secret: 'test-only-secret-with-at-least-32-characters',
    dbReady: () => true
  });

  agent = request.agent(app);

  token = (
    await agent.get('/auth/csrf').expect(200)
  ).body.csrfToken;
});

function write(method, path, data) {
  const call = agent[method](path)
    .set('X-CSRF-Token', token);

  return data === undefined ? call : call.send(data);
}

function newIdentity() {
  currentUser = {
    oauthProvider: 'google',
    providerId: 'demo-google-id',
    displayName: 'New User',
    email: 'new@example.com'
  };
}

test('OAuth profile POST sets identity and role on the server', async () => {
  newIdentity();

  const response = await write(
    'post',
    '/api/users',
    { displayName: 'New User' }
  ).expect(201);

  expect(models.users.create).toHaveBeenCalledWith(
    expect.objectContaining({
      providerId: 'demo-google-id',
      email: 'new@example.com',
      role: 'adopter'
    })
  );

  expect(response.body.data.providerId).toBeUndefined();
});

test('existing profile POST returns 409', async () => {
  await write('post', '/api/users', {}).expect(409);
});

test.each([
  { role: 'admin' },
  { email: 'fake@example.com' },
  { displayName: 'X' }
])(
  'profile POST rejects invalid or server-controlled fields %j',
  async (input) => {
    newIdentity();

    await write('post', '/api/users', input).expect(400);

    expect(models.users.create).not.toHaveBeenCalled();
  }
);

test('owner updates display name', async () => {
  const response = await write(
    'put',
    `/api/users/${USER}`,
    { displayName: 'Updated Name' }
  ).expect(200);

  expect(response.body.data.displayName)
    .toBe('Updated Name');
});

test('owner cannot promote themselves', async () => {
  await write(
    'put',
    `/api/users/${USER}`,
    { role: 'admin' }
  ).expect(403);

  expect(models.users.findOneAndUpdate)
    .not.toHaveBeenCalled();
});

test('owner cannot update another user', async () => {
  await write(
    'put',
    `/api/users/${OTHER}`,
    { displayName: 'Updated Name' }
  ).expect(403);
});

test('admin cannot change their own permissions', async () => {
  currentUser.role = 'admin';

  await write(
    'put',
    `/api/users/${USER}`,
    { role: 'adopter' }
  ).expect(403);
});

test('admin assigns staff to an existing shelter', async () => {
  currentUser.role = 'admin';

  await write(
    'put',
    `/api/users/${OTHER}`,
    {
      role: 'shelterStaff',
      shelterId: SHELTER
    }
  ).expect(200);
});

test('staff assignment requires shelter', async () => {
  currentUser.role = 'admin';

  models.users.findOne.mockReturnValue(
    query({ _id: OTHER, role: 'adopter' })
  );

  await write(
    'put',
    `/api/users/${OTHER}`,
    { role: 'shelterStaff' }
  ).expect(400);
});

test('staff assignment rejects missing shelter', async () => {
  currentUser.role = 'admin';
  models.shelters.exists.mockResolvedValue(null);

  await write(
    'put',
    `/api/users/${OTHER}`,
    {
      role: 'shelterStaff',
      shelterId: SHELTER
    }
  ).expect(404);
});

test('changing staff to adopter clears shelter assignment', async () => {
  currentUser.role = 'admin';

  models.users.findOne.mockReturnValue(
    query({
      _id: OTHER,
      role: 'shelterStaff',
      shelterId: SHELTER
    })
  );

  await write(
    'put',
    `/api/users/${OTHER}`,
    { role: 'adopter' }
  ).expect(200);

  expect(
    models.users.findOneAndUpdate.mock.calls[0][1].$unset
  ).toEqual({ shelterId: 1 });
});

test('non-staff role cannot receive shelter assignment', async () => {
  currentUser.role = 'admin';

  await write(
    'put',
    `/api/users/${OTHER}`,
    {
      role: 'adopter',
      shelterId: SHELTER
    }
  ).expect(400);
});

test.each([
  {},
  { displayName: 'X' },
  { email: 'fake@example.com' }
])('user PUT validates %j', async (input) => {
  await write(
    'put',
    `/api/users/${USER}`,
    input
  ).expect(400);
});

test('owner deletes unreferenced non-admin profile', async () => {
  await write(
    'delete',
    `/api/users/${USER}`
  ).expect(204);
});

test('owner cannot delete another user', async () => {
  await write(
    'delete',
    `/api/users/${OTHER}`
  ).expect(403);
});

test('admin can delete an unreferenced adopter', async () => {
  currentUser.role = 'admin';

  models.users.findOne.mockReturnValue(
    query({ _id: OTHER, role: 'adopter' })
  );

  await write(
    'delete',
    `/api/users/${OTHER}`
  ).expect(204);
});

test('admin profile deletion returns 409', async () => {
  currentUser.role = 'admin';

  await write(
    'delete',
    `/api/users/${USER}`
  ).expect(409);
});

test('user deletion checks adopter and reviewer references', async () => {
  models.applications.exists.mockResolvedValue({
    _id: APPLICATION
  });

  await write(
    'delete',
    `/api/users/${USER}`
  ).expect(409);

  expect(models.applications.exists)
    .toHaveBeenCalledWith({
      $or: [
        { adopterId: USER },
        { reviewedBy: USER }
      ]
    });
});

test('application POST derives ownership, shelter, and status', async () => {
  const response = await write(
    'post',
    '/api/applications',
    body
  ).expect(201);

  expect(response.body.data).toMatchObject({
    adopterId: USER,
    shelterId: SHELTER,
    status: 'submitted'
  });
});

test.each([
  {},
  { ...body, status: 'approved' },
  { ...body, adopterId: OTHER },
  { ...body, motivation: 'Short' },
  { ...body, hasOtherPets: 'false' }
])('application POST validates %j', async (input) => {
  await write(
    'post',
    '/api/applications',
    input
  ).expect(400);

  expect(models.applications.create)
    .not.toHaveBeenCalled();
});

test('application POST rejects missing pet', async () => {
  models.pets.findOne.mockReturnValue(query(null));

  await write(
    'post',
    '/api/applications',
    body
  ).expect(404);
});

test('application POST rejects unavailable pet', async () => {
  models.pets.findOne.mockReturnValue(
    query({
      _id: PET,
      adoptionStatus: 'adopted'
    })
  );

  await write(
    'post',
    '/api/applications',
    body
  ).expect(409);
});

test('application POST rejects missing shelter', async () => {
  models.shelters.exists.mockResolvedValue(null);

  await write(
    'post',
    '/api/applications',
    body
  ).expect(404);
});

test('application POST rejects deleted user', async () => {
  models.users.exists.mockResolvedValue(null);

  await write(
    'post',
    '/api/applications',
    body
  ).expect(409);
});

test('duplicate application returns 409', async () => {
  models.applications.create.mockRejectedValue(
    Object.assign(
      new Error('Duplicate'),
      { code: 11000 }
    )
  );

  await write(
    'post',
    '/api/applications',
    body
  ).expect(409);
});

test('applicant updates submitted details', async () => {
  const response = await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { contactPhone: '555-9999' }
  ).expect(200);

  expect(response.body.data.contactPhone)
    .toBe('555-9999');

  expect(models.applications.findOne)
    .toHaveBeenCalledWith({
      _id: APPLICATION,
      adopterId: USER
    });
});

test.each([
  {},
  { motivation: 'Short' },
  { petId: PET },
  { status: 'submitted' }
])('application PUT validates %j', async (input) => {
  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    input
  ).expect(400);
});

test('applicant withdraws application', async () => {
  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { status: 'withdrawn' }
  ).expect(200);
});

test('applicant cannot approve application', async () => {
  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { status: 'approved' }
  ).expect(403);
});

test('admin cannot review own application', async () => {
  currentUser.role = 'admin';

  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { status: 'approved' }
  ).expect(403);
});

test('assigned staff review records reviewer and time', async () => {
  currentUser = {
    ...currentUser,
    _id: OTHER,
    role: 'shelterStaff'
  };

  const response = await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { status: 'underReview' }
  ).expect(200);

  expect(response.body.data.reviewedBy).toBe(OTHER);
  expect(response.body.data.reviewedAt).toBeTruthy();

  expect(models.applications.findOne)
    .toHaveBeenCalledWith({
      _id: APPLICATION,
      shelterId: SHELTER
    });
});

test('admin can approve another applicant', async () => {
  currentUser = {
    ...currentUser,
    _id: OTHER,
    role: 'admin'
  };

  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { status: 'approved' }
  ).expect(200);
});

test('reviewer cannot edit applicant answers', async () => {
  currentUser = {
    ...currentUser,
    _id: OTHER,
    role: 'admin'
  };

  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { contactPhone: '555-2222' }
  ).expect(403);
});

test('reviewed application details cannot change', async () => {
  record.status = 'underReview';

  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { contactPhone: '555-2222' }
  ).expect(409);
});

test('final application cannot reopen', async () => {
  record.status = 'rejected';

  currentUser = {
    ...currentUser,
    _id: OTHER,
    role: 'admin'
  };

  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { status: 'underReview' }
  ).expect(409);
});

test('concurrent application status change returns 409', async () => {
  models.applications.findOneAndUpdate
    .mockResolvedValue(null);

  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { status: 'withdrawn' }
  ).expect(409);

  expect(
    models.applications.findOneAndUpdate
      .mock.calls[0][0].status
  ).toBe('submitted');
});

test('inaccessible application returns 404', async () => {
  models.applications.findOne.mockReturnValue(
    query(null)
  );

  await write(
    'put',
    `/api/applications/${APPLICATION}`,
    { status: 'withdrawn' }
  ).expect(404);
});

test('applicant deletes submitted application', async () => {
  const response = await write(
    'delete',
    `/api/applications/${APPLICATION}`
  ).expect(204);

  expect(response.text).toBe('');
});

test('applicant cannot delete under-review application', async () => {
  record.status = 'underReview';

  await write(
    'delete',
    `/api/applications/${APPLICATION}`
  ).expect(403);
});

test('approved application cannot be deleted even by admin', async () => {
  record.status = 'approved';
  currentUser.role = 'admin';

  await write(
    'delete',
    `/api/applications/${APPLICATION}`
  ).expect(409);
});

test.each([
  'users',
  'applications'
])('%s missing PUT/DELETE records return 404', async (resource) => {
  models[resource].findOne.mockReturnValue(
    query(null)
  );

  const id =
    resource === 'users'
      ? USER
      : APPLICATION;

  const input =
    resource === 'users'
      ? { displayName: 'Valid Name' }
      : { contactPhone: '555' };

  await write(
    'put',
    `/api/${resource}/${id}`,
    input
  ).expect(404);

  await write(
    'delete',
    `/api/${resource}/${id}`
  ).expect(404);
});

test.each([
  'users',
  'applications'
])('%s malformed write IDs return 400', async (resource) => {
  await write(
    'put',
    `/api/${resource}/invalid`,
    { displayName: 'Valid Name' }
  ).expect(400);

  await write(
    'delete',
    `/api/${resource}/invalid`
  ).expect(400);
});

test.each([
  'users',
  'shelters',
  'pets',
  'applications'
])('%s writes require authentication', async (resource) => {
  currentUser = null;

  await write(
    'post',
    `/api/${resource}`,
    {}
  ).expect(401);

  await write(
    'put',
    `/api/${resource}/${USER}`,
    {}
  ).expect(401);

  await write(
    'delete',
    `/api/${resource}/${USER}`
  ).expect(401);
});

test.each([
  'users',
  'applications'
])('%s writes require CSRF', async (resource) => {
  await agent
    .post(`/api/${resource}`)
    .send({})
    .expect(403);

  await agent
    .put(`/api/${resource}/${USER}`)
    .send({})
    .expect(403);

  await agent
    .delete(`/api/${resource}/${USER}`)
    .expect(403);
});

test('logout destroys session and protected reads then return 401', async () => {
  await write(
    'post',
    '/auth/logout'
  ).expect(204);

  await agent.get('/auth/me').expect(401);
  await agent.get('/api/applications').expect(401);
});

test.each([
  ['users', 'create', 'post'],
  ['users', 'findOneAndUpdate', 'put'],
  ['users', 'findOneAndDelete', 'delete'],
  ['applications', 'create', 'post'],
  ['applications', 'findOneAndUpdate', 'put'],
  ['applications', 'findOneAndDelete', 'delete']
])(
  '%s %s database failures return safe 500',
  async (resource, operation, method) => {
    if (
      resource === 'users' &&
      method === 'post'
    ) {
      newIdentity();
    }

    models[resource][operation].mockRejectedValue(
      new Error('Private database details')
    );

    const path =
      `/api/${resource}` +
      (
        method === 'post'
          ? ''
          : `/${resource === 'users' ? USER : APPLICATION}`
      );

    const input =
      method === 'post'
        ? (
            resource === 'users'
              ? {}
              : body
          )
        : method === 'put'
          ? (
              resource === 'users'
                ? { displayName: 'Valid Name' }
                : { contactPhone: '555' }
            )
          : undefined;

    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      const response = await write(
        method,
        path,
        input
      ).expect(500);

      expect(response.body.error.message)
        .toBe('An unexpected server error occurred.');

      expect(response.text)
        .not.toContain('Private database details');
    } finally {
      spy.mockRestore();
    }
  }
);

test('Swagger has implemented writes and correct success codes for all four collections', async () => {
  const spec = (
    await agent.get('/api-docs.json').expect(200)
  ).body;

  for (const [resource, parameter] of [
    ['users', 'userId'],
    ['shelters', 'shelterId'],
    ['pets', 'petId'],
    ['applications', 'applicationId']
  ]) {
    const collection =
      spec.paths[`/api/${resource}`];

    const item =
      spec.paths[
        `/api/${resource}/{${parameter}}`
      ];

    for (const operation of [
      collection.post,
      item.put,
      item.delete
    ]) {
      expect(operation['x-implementation-status'])
        .toBe('implemented');

      expect(operation.responses['501'])
        .toBeUndefined();
    }

    expect(collection.post.responses['201'])
      .toBeDefined();

    expect(item.put.responses['200'])
      .toBeDefined();

    expect(item.delete.responses['204'])
      .toBeDefined();
  }
});