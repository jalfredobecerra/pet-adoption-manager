const request = require('supertest');
const session = require('express-session');

const { createApp } = require('../src/app');

const USER_ID = '507f1f77bcf86cd799439010';
const SHELTER_ID = '507f1f77bcf86cd799439011';
const PET_ID = '507f1f77bcf86cd799439012';
const OTHER_SHELTER_ID = '507f1f77bcf86cd799439013';

const shelterBody = {
  name: 'Video Demo Shelter',
  description: 'Demonstration shelter.',
  contactEmail: 'video@example.invalid',
  phone: '+1-202-555-0100',
  streetAddress: '100 Example Street',
  city: 'Example City',
  stateOrRegion: 'Example Region',
  postalCode: '10001'
};

const petBody = {
  name: 'Video Demo Luna',
  species: 'dog',
  breed: 'Mixed breed',
  ageMonths: 10,
  sex: 'female',
  description: 'A friendly demonstration pet.',
  adoptionStatus: 'available',
  shelterId: SHELTER_ID
};

let app;
let models;
let currentUser;
let agent;
let token;

function query(value) {
  const result = {
    lean: jest.fn().mockResolvedValue(value)
  };

  for (const method of [
    'select',
    'sort',
    'skip',
    'limit'
  ]) {
    result[method] = jest.fn().mockReturnValue(result);
  }

  return result;
}

function mockModel(document) {
  return {
    find: jest.fn(() =>
      query(document ? [document] : [])
    ),
    findOne: jest.fn(() => query(document)),
    exists: jest.fn().mockResolvedValue(null),
    create: jest.fn(async (input) => ({
      ...input,
      _id: document?._id
    })),
    findOneAndUpdate: jest.fn(async (filter, update) => ({
      ...document,
      ...update.$set
    })),
    findOneAndDelete: jest.fn().mockResolvedValue(document)
  };
}

beforeEach(async () => {
  currentUser = {
    _id: USER_ID,
    displayName: 'Julian Becerra',
    role: 'admin',
    shelterId: SHELTER_ID
  };

  models = {
    users: mockModel({ _id: USER_ID }),
    shelters: mockModel({
      _id: SHELTER_ID,
      ...shelterBody
    }),
    pets: mockModel({
      _id: PET_ID,
      ...petBody
    }),
    applications: mockModel(null)
  };

  models.shelters.exists.mockResolvedValue({
    _id: SHELTER_ID
  });

  const passport = {
    initialize: () => (req, res, next) => {
      req.logout = (done) => done();
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
    secret: 'test-only-secret-at-least-32-characters',
    dbReady: () => true
  });

  agent = request.agent(app);

  const response = await agent
    .get('/auth/csrf')
    .expect(200);

  token = response.body.csrfToken;
});

function write(method, path, body) {
  const operation = agent[method](path)
    .set('X-CSRF-Token', token);

  return body === undefined
    ? operation
    : operation.send(body);
}

describe.each([
  ['shelters', SHELTER_ID, shelterBody, { phone: '+1-202-555-0101' }],
  ['pets', PET_ID, petBody, { ageMonths: 11 }]
])('%s CRUD writes', (resource, id, createBody, updateBody) => {
  test('POST creates a document and returns 201', async () => {
    const response = await write(
      'post',
      `/api/${resource}`,
      createBody
    ).expect(201);

    expect(response.body.data._id).toBe(id);
    expect(models[resource].create)
      .toHaveBeenCalledWith(createBody);
  });

  test('PUT returns the updated document', async () => {
    const response = await write(
      'put',
      `/api/${resource}/${id}`,
      updateBody
    ).expect(200);

    expect(response.body.data).toEqual(
      expect.objectContaining(updateBody)
    );
  });

  test('DELETE returns 204 and an empty body', async () => {
    const response = await write(
      'delete',
      `/api/${resource}/${id}`
    ).expect(204);

    expect(response.text).toBe('');
    expect(models[resource].findOneAndDelete)
      .toHaveBeenCalled();
  });

  test('POST rejects missing required fields', async () => {
    const response = await write(
      'post',
      `/api/${resource}`,
      {}
    ).expect(400);

    expect(response.body.error.details.length)
      .toBeGreaterThan(0);

    expect(models[resource].create)
      .not.toHaveBeenCalled();
  });

  test('PUT rejects an empty update', async () => {
    await write(
      'put',
      `/api/${resource}/${id}`,
      {}
    ).expect(400);
  });

  test('PUT rejects unknown fields', async () => {
    await write(
      'put',
      `/api/${resource}/${id}`,
      { role: 'admin' }
    ).expect(400);
  });

  test('PUT rejects an invalid ID', async () => {
    await write(
      'put',
      `/api/${resource}/invalid`,
      updateBody
    ).expect(400);
  });

  test('DELETE rejects an invalid ID', async () => {
    await write(
      'delete',
      `/api/${resource}/invalid`
    ).expect(400);
  });

  test('writes require authentication', async () => {
    currentUser = null;

    await write(
      'post',
      `/api/${resource}`,
      createBody
    ).expect(401);

    await write(
      'put',
      `/api/${resource}/${id}`,
      updateBody
    ).expect(401);

    await write(
      'delete',
      `/api/${resource}/${id}`
    ).expect(401);
  });

  test('POST requires a valid CSRF token', async () => {
    await agent
      .post(`/api/${resource}`)
      .send(createBody)
      .expect(403);
  });

  test('adopters cannot create, update, or delete', async () => {
    currentUser.role = 'adopter';

    await write(
      'post',
      `/api/${resource}`,
      createBody
    ).expect(403);

    await write(
      'put',
      `/api/${resource}/${id}`,
      updateBody
    ).expect(403);

    await write(
      'delete',
      `/api/${resource}/${id}`
    ).expect(403);
  });

  test.each([
    ['post', 'create'],
    ['put', 'findOneAndUpdate'],
    ['delete', 'findOneAndDelete']
  ])('%s handles database failures', async (method, modelMethod) => {
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      models[resource][modelMethod].mockRejectedValue(
        new Error('Private database information')
      );

      const body =
        method === 'post'
          ? createBody
          : method === 'put'
            ? updateBody
            : undefined;

      const path =
        method === 'post'
          ? `/api/${resource}`
          : `/api/${resource}/${id}`;

      const response = await write(method, path, body)
        .expect(500);

      expect(response.body.error.message).toBe(
        'An unexpected server error occurred.'
      );

      expect(response.text).not.toContain(
        'Private database information'
      );

      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

test('shelter staff can update their assigned shelter', async () => {
  currentUser.role = 'shelterStaff';

  await write(
    'put',
    `/api/shelters/${SHELTER_ID}`,
    { phone: '+1-202-555-0101' }
  ).expect(200);
});

test('shelter staff cannot update another shelter', async () => {
  currentUser.role = 'shelterStaff';

  await write(
    'put',
    `/api/shelters/${OTHER_SHELTER_ID}`,
    { phone: '+1-202-555-0101' }
  ).expect(403);
});

test('shelter staff cannot create or delete shelters', async () => {
  currentUser.role = 'shelterStaff';

  await write(
    'post',
    '/api/shelters',
    shelterBody
  ).expect(403);

  await write(
    'delete',
    `/api/shelters/${SHELTER_ID}`
  ).expect(403);
});

test('shelter staff can create pets for their shelter', async () => {
  currentUser.role = 'shelterStaff';

  await write('post', '/api/pets', petBody).expect(201);
});

test('shelter staff cannot create pets for another shelter', async () => {
  currentUser.role = 'shelterStaff';

  await write('post', '/api/pets', {
    ...petBody,
    shelterId: OTHER_SHELTER_ID
  }).expect(403);
});

test('shelter staff cannot update another shelter’s pet', async () => {
  currentUser.role = 'shelterStaff';

  models.pets.findOne.mockReturnValue(
    query({
      _id: PET_ID,
      ...petBody,
      shelterId: OTHER_SHELTER_ID
    })
  );

  await write(
    'put',
    `/api/pets/${PET_ID}`,
    { ageMonths: 11 }
  ).expect(403);
});

test('pet POST rejects a nonexistent shelter', async () => {
  models.shelters.exists.mockResolvedValue(null);

  await write('post', '/api/pets', petBody).expect(404);
});

test('pet PUT rejects a negative age', async () => {
  await write(
    'put',
    `/api/pets/${PET_ID}`,
    { ageMonths: -1 }
  ).expect(400);

  expect(models.pets.findOneAndUpdate)
    .not.toHaveBeenCalled();
});

test('shelter PUT rejects an invalid email', async () => {
  await write(
    'put',
    `/api/shelters/${SHELTER_ID}`,
    { contactEmail: 'invalid-email' }
  ).expect(400);
});

test('shelter PUT returns 404 for a missing record', async () => {
  models.shelters.findOneAndUpdate.mockResolvedValue(null);

  await write(
    'put',
    `/api/shelters/${SHELTER_ID}`,
    { phone: '+1-202-555-0101' }
  ).expect(404);
});

test('pet PUT returns 404 for a missing record', async () => {
  models.pets.findOne.mockReturnValue(query(null));

  await write(
    'put',
    `/api/pets/${PET_ID}`,
    { ageMonths: 11 }
  ).expect(404);
});

test.each([
  ['shelters', SHELTER_ID],
  ['pets', PET_ID]
])('%s DELETE returns 404 for a missing record', async (resource, id) => {
  models[resource].findOne.mockReturnValue(query(null));

  await write(
    'delete',
    `/api/${resource}/${id}`
  ).expect(404);
});

test('pet DELETE rejects application references', async () => {
  models.applications.exists.mockResolvedValue({
    _id: 'application-id'
  });

  await write(
    'delete',
    `/api/pets/${PET_ID}`
  ).expect(409);

  expect(models.pets.findOneAndDelete)
    .not.toHaveBeenCalled();
});

test.each([
  'pets',
  'applications',
  'users'
])('shelter DELETE rejects references from %s', async (resource) => {
  models[resource].exists.mockResolvedValue({
    _id: 'referencing-record'
  });

  await write(
    'delete',
    `/api/shelters/${SHELTER_ID}`
  ).expect(409);

  expect(models.shelters.findOneAndDelete)
    .not.toHaveBeenCalled();
});

test('pet shelter transfer rejects existing applications', async () => {
  models.applications.exists.mockResolvedValue({
    _id: 'application-id'
  });

  await write(
    'put',
    `/api/pets/${PET_ID}`,
    { shelterId: OTHER_SHELTER_ID }
  ).expect(409);
});

test('shelter staff cannot transfer a pet', async () => {
  currentUser.role = 'shelterStaff';

  await write(
    'put',
    `/api/pets/${PET_ID}`,
    { shelterId: OTHER_SHELTER_ID }
  ).expect(403);
});

test('admin can transfer a pet without application references', async () => {
  const response = await write(
    'put',
    `/api/pets/${PET_ID}`,
    { shelterId: OTHER_SHELTER_ID }
  ).expect(200);

  expect(response.body.data.shelterId)
    .toBe(OTHER_SHELTER_ID);
});

test('Swagger marks shelter and pet writes as implemented', async () => {
  const response = await agent
    .get('/api-docs.json')
    .expect(200);

  for (const [resource, parameter] of [
    ['shelters', 'shelterId'],
    ['pets', 'petId']
  ]) {
    const collection =
      response.body.paths[`/api/${resource}`];

    const item =
      response.body.paths[`/api/${resource}/{${parameter}}`];

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

    expect(collection.post.responses['201']).toBeDefined();
    expect(item.put.responses['200']).toBeDefined();
    expect(item.delete.responses['204']).toBeDefined();
  }
});