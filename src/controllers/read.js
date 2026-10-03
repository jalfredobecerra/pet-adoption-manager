const resources = require('../resources');
const { httpError } = require('../middleware/security');

const isId = (value) =>
  typeof value === 'string' &&
  /^[a-f\d]{24}$/i.test(value);

function integer(value, fallback, maximum) {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value)
  ) {
    throw httpError(400, 'Invalid pagination value.');
  }

  const result = Number(value);

  if (!Number.isSafeInteger(result) || result > maximum) {
    throw httpError(400, 'Pagination value is out of range.');
  }

  return result;
}

function scopeFor(resource, req, single) {
  if (resource === 'pets' || resource === 'shelters') {
    return {};
  }

  if (!req.isAuthenticated()) {
    throw httpError(401, 'Sign in with Google first.');
  }

  if (!req.user._id) {
    throw httpError(403, 'Complete your profile first.');
  }

  if (req.user.role === 'admin') {
    return {};
  }

  if (resource === 'users') {
    if (!single) {
      throw httpError(403, 'Administrator access required.');
    }

    if (req.params.userId !== String(req.user._id)) {
      throw httpError(403, 'You may only read your own profile.');
    }

    return { _id: req.user._id };
  }

  if (req.user.role === 'adopter') {
    return { adopterId: req.user._id };
  }

  if (
    req.user.role === 'shelterStaff' &&
    req.user.shelterId
  ) {
    return { shelterId: req.user.shelterId };
  }

  throw httpError(403, 'Access denied.');
}

function petFilters(query) {
  const filters = {};

  if (query.species !== undefined) {
    const allowed = ['dog', 'cat', 'rabbit', 'bird', 'other'];

    if (!allowed.includes(query.species)) {
      throw httpError(400, 'Invalid species.');
    }

    filters.species = query.species;
  }

  if (query.status !== undefined) {
    const allowed = ['available', 'pending', 'adopted'];

    if (!allowed.includes(query.status)) {
      throw httpError(400, 'Invalid adoption status.');
    }

    filters.adoptionStatus = query.status;
  }

  if (query.shelterId !== undefined) {
    if (!isId(query.shelterId)) {
      throw httpError(400, 'Invalid shelterId.');
    }

    filters.shelterId = query.shelterId;
  }

  return filters;
}

function createReadControllers(models) {
  return Object.fromEntries(
    Object.entries(resources).map(([resource, settings]) => {
      const Model = models[resource];

      return [
        resource,
        {
          async list(req, res) {
            const allowedQueries = [
              'page',
              'limit',
              ...(resource === 'pets'
                ? ['species', 'status', 'shelterId']
                : [])
            ];

            if (
              Object.keys(req.query).some(
                (key) => !allowedQueries.includes(key)
              )
            ) {
              throw httpError(400, 'Unsupported query parameter.');
            }

            const page = integer(req.query.page, 1, 10000);
            const limit = integer(req.query.limit, 20, 100);

            const filter = {
              ...scopeFor(resource, req, false),
              ...(resource === 'pets'
                ? petFilters(req.query)
                : {})
            };

            const data = await Model.find(filter)
              .select(settings.projection || '')
              .sort({ _id: 1 })
              .skip((page - 1) * limit)
              .limit(limit)
              .lean();

            res.json({ data, page, limit });
          },

          async single(req, res) {
            const id = req.params[settings.idParam];

            if (!isId(id)) {
              throw httpError(400, 'Invalid document ID.');
            }

            const filter = {
              ...scopeFor(resource, req, true),
              _id: id
            };

            const data = await Model.findOne(filter)
              .select(settings.projection || '')
              .lean();

            if (!data) {
              throw httpError(404, 'Record not found.');
            }

            res.json({ data });
          }
        }
      ];
    })
  );
}

module.exports = {
  createReadControllers,
  isId
};