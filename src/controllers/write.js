const { httpError } = require('../middleware/security');
const { isId } = require('./read');

const {
  shelterCreate,
  shelterUpdate,
  petCreate,
  petUpdate,
  parseBody
} = require('../validators/crud');

function checkedId(value) {
  if (!isId(value)) {
    throw httpError(400, 'Invalid document ID.');
  }

  return value;
}

function requireAdmin(user) {
  if (user.role !== 'admin') {
    throw httpError(403, 'Administrator access required.');
  }
}

function requireShelterAccess(user, shelterId) {
  if (user.role === 'admin') {
    return;
  }

  if (
    user.role === 'shelterStaff' &&
    user.shelterId &&
    String(user.shelterId).toLowerCase() ===
      String(shelterId).toLowerCase()
  ) {
    return;
  }

  throw httpError(
    403,
    'You may only manage your assigned shelter and its pets.'
  );
}

function createWriteControllers(models) {
  return {
    shelters: {
      async create(req, res, next) {
        try {
          requireAdmin(req.user);

          const input = parseBody(shelterCreate, req.body);
          const shelter = await models.shelters.create(input);

          res.status(201).json({
            data: shelter
          });
        } catch (error) {
          next(error);
        }
      },

      async update(req, res, next) {
        try {
          const shelterId = checkedId(req.params.shelterId);

          requireShelterAccess(req.user, shelterId);

          const input = parseBody(shelterUpdate, req.body);

          const shelter = await models.shelters.findOneAndUpdate(
            { _id: shelterId },
            { $set: input },
            {
              returnDocument: 'after',
              runValidators: true
            }
          );

          if (!shelter) {
            throw httpError(404, 'Shelter not found.');
          }

          res.json({
            data: shelter
          });
        } catch (error) {
          next(error);
        }
      },

      async remove(req, res, next) {
        try {
          requireAdmin(req.user);

          const shelterId = checkedId(req.params.shelterId);

          const existing = await models.shelters
            .findOne({ _id: shelterId })
            .lean();

          if (!existing) {
            throw httpError(404, 'Shelter not found.');
          }

          const [pet, application, assignedUser] =
            await Promise.all([
              models.pets.exists({ shelterId }),
              models.applications.exists({ shelterId }),
              models.users.exists({ shelterId })
            ]);

          if (pet || application || assignedUser) {
            throw httpError(
              409,
              'Remove or reassign records referencing this shelter before deleting it.'
            );
          }

          const deleted = await models.shelters.findOneAndDelete({
            _id: shelterId
          });

          if (!deleted) {
            throw httpError(404, 'Shelter not found.');
          }

          res.status(204).end();
        } catch (error) {
          next(error);
        }
      }
    },

    pets: {
      async create(req, res, next) {
        try {
          const input = parseBody(petCreate, req.body);

          requireShelterAccess(req.user, input.shelterId);

          const shelter = await models.shelters.exists({
            _id: input.shelterId
          });

          if (!shelter) {
            throw httpError(404, 'Referenced shelter not found.');
          }

          const pet = await models.pets.create(input);

          res.status(201).json({
            data: pet
          });
        } catch (error) {
          next(error);
        }
      },

      async update(req, res, next) {
        try {
          const petId = checkedId(req.params.petId);
          const input = parseBody(petUpdate, req.body);

          const existing = await models.pets
            .findOne({ _id: petId })
            .lean();

          if (!existing) {
            throw httpError(404, 'Pet not found.');
          }

          requireShelterAccess(req.user, existing.shelterId);

          const movingShelter =
            input.shelterId &&
            String(input.shelterId).toLowerCase() !==
              String(existing.shelterId).toLowerCase();

          if (movingShelter) {
            requireAdmin(req.user);

            const application = await models.applications.exists({
              petId
            });

            if (application) {
              throw httpError(
                409,
                'A pet with application records cannot be moved to another shelter.'
              );
            }

            const newShelter = await models.shelters.exists({
              _id: input.shelterId
            });

            if (!newShelter) {
              throw httpError(404, 'Referenced shelter not found.');
            }
          }

          const pet = await models.pets.findOneAndUpdate(
            {
              _id: petId,
              shelterId: existing.shelterId
            },
            { $set: input },
            {
              returnDocument: 'after',
              runValidators: true
            }
          );

          if (!pet) {
            throw httpError(
              404,
              'Pet not found or changed during this request.'
            );
          }

          res.json({
            data: pet
          });
        } catch (error) {
          next(error);
        }
      },

      async remove(req, res, next) {
        try {
          const petId = checkedId(req.params.petId);

          const existing = await models.pets
            .findOne({ _id: petId })
            .lean();

          if (!existing) {
            throw httpError(404, 'Pet not found.');
          }

          requireShelterAccess(req.user, existing.shelterId);

          const application = await models.applications.exists({
            petId
          });

          if (application) {
            throw httpError(
              409,
              'A pet with application records cannot be deleted.'
            );
          }

          const deleted = await models.pets.findOneAndDelete({
            _id: petId,
            shelterId: existing.shelterId
          });

          if (!deleted) {
            throw httpError(
              404,
              'Pet not found or changed during this request.'
            );
          }

          res.status(204).end();
        } catch (error) {
          next(error);
        }
      }
    }
  };
}

module.exports = { createWriteControllers };