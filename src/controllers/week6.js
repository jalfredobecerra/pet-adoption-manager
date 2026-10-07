const {
  httpError,
  publicUser
} = require('../middleware/security');

const { parseBody } = require('../validators/crud');
const schemas = require('../validators/week6');

const sameId = (a, b) =>
  a != null &&
  b != null &&
  String(a).toLowerCase() === String(b).toLowerCase();

function checkedId(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-f\d]{24}$/i.test(value)
  ) {
    throw httpError(400, 'Invalid document ID.');
  }

  return value.toLowerCase();
}

function applicationScope(user) {
  if (user.role === 'admin') {
    return {};
  }

  if (user.role === 'adopter') {
    return { adopterId: user._id };
  }

  if (user.role === 'shelterStaff' && user.shelterId) {
    return { shelterId: user.shelterId };
  }

  throw httpError(403, 'Access denied.');
}

function canReview(user, application) {
  return (
    user.role === 'admin' ||
    (
      user.role === 'shelterStaff' &&
      sameId(user.shelterId, application.shelterId)
    )
  );
}

function createWeek6Controllers(models) {
  return {
    users: {
      async create(req, res, next) {
        try {
          if (req.user._id) {
            throw httpError(
              409,
              'Your profile already exists.'
            );
          }

          const input = parseBody(
            schemas.userCreate,
            req.body
          );

          const user = await models.users.create({
            oauthProvider: req.user.oauthProvider,
            providerId: req.user.providerId,
            email: req.user.email,
            displayName:
              input.displayName || req.user.displayName,
            role: 'adopter'
          });

          res.status(201).json({
            data: publicUser(user)
          });
        } catch (error) {
          next(error);
        }
      },

      async update(req, res, next) {
        try {
          const id = checkedId(req.params.userId);
          const input = parseBody(
            schemas.userUpdate,
            req.body
          );

          const admin = req.user.role === 'admin';
          const owner = sameId(id, req.user._id);

          if (!admin && !owner) {
            throw httpError(
              403,
              'You may only update your own profile.'
            );
          }

          const changesPermissions =
            'role' in input || 'shelterId' in input;

          if (changesPermissions && !admin) {
            throw httpError(
              403,
              'Only administrators may change roles or shelter assignments.'
            );
          }

          if (changesPermissions && owner) {
            throw httpError(
              403,
              'Administrators cannot change their own permissions.'
            );
          }

          const existing = await models.users
            .findOne({ _id: id })
            .lean();

          if (!existing) {
            throw httpError(404, 'User not found.');
          }

          const update = {
            $set: { ...input }
          };

          if (changesPermissions) {
            const role = input.role ?? existing.role;

            const shelterId =
              'shelterId' in input
                ? input.shelterId
                : existing.shelterId;

            if (role === 'shelterStaff') {
              if (!shelterId) {
                throw httpError(
                  400,
                  'Shelter staff require a shelterId.'
                );
              }

              const shelterExists =
                await models.shelters.exists({
                  _id: shelterId
                });

              if (!shelterExists) {
                throw httpError(
                  404,
                  'Assigned shelter not found.'
                );
              }

              update.$set.shelterId = shelterId;
            } else {
              if (input.shelterId != null) {
                throw httpError(
                  400,
                  'Only shelter staff may have a shelter assignment.'
                );
              }

              delete update.$set.shelterId;
              update.$unset = { shelterId: 1 };
            }
          }

          const user =
            await models.users.findOneAndUpdate(
              {
                _id: id,
                role: existing.role
              },
              update,
              {
                returnDocument: 'after',
                runValidators: true
              }
            );

          if (!user) {
            throw httpError(
              409,
              'User changed or was removed. Refresh and retry.'
            );
          }

          res.json({
            data: publicUser(user)
          });
        } catch (error) {
          next(error);
        }
      },

      async remove(req, res, next) {
        try {
          const id = checkedId(req.params.userId);

          if (
            req.user.role !== 'admin' &&
            !sameId(id, req.user._id)
          ) {
            throw httpError(
              403,
              'You may only delete your own profile.'
            );
          }

          const existing = await models.users
            .findOne({ _id: id })
            .lean();

          if (!existing) {
            throw httpError(404, 'User not found.');
          }

          if (existing.role === 'admin') {
            throw httpError(
              409,
              'Administrator profiles cannot be deleted.'
            );
          }

          const referenced =
            await models.applications.exists({
              $or: [
                { adopterId: id },
                { reviewedBy: id }
              ]
            });

          if (referenced) {
            throw httpError(
              409,
              'Application records reference this user.'
            );
          }

          const deleted =
            await models.users.findOneAndDelete({
              _id: id,
              role: existing.role
            });

          if (!deleted) {
            throw httpError(
              409,
              'User changed or was removed. Refresh and retry.'
            );
          }

          res.status(204).end();
        } catch (error) {
          next(error);
        }
      }
    },

    applications: {
      async create(req, res, next) {
        try {
          const input = parseBody(
            schemas.applicationCreate,
            req.body
          );

          const pet = await models.pets
            .findOne({ _id: input.petId })
            .lean();

          if (!pet) {
            throw httpError(404, 'Pet not found.');
          }

          if (pet.adoptionStatus !== 'available') {
            throw httpError(
              409,
              'This pet is not available for applications.'
            );
          }

          const shelterExists =
            await models.shelters.exists({
              _id: pet.shelterId
            });

          if (!shelterExists) {
            throw httpError(
              404,
              'Pet shelter not found.'
            );
          }

          const userExists =
            await models.users.exists({
              _id: req.user._id
            });

          if (!userExists) {
            throw httpError(
              409,
              'Your profile no longer exists.'
            );
          }

          const application =
            await models.applications.create({
              ...input,
              adopterId: req.user._id,
              shelterId: pet.shelterId,
              status: 'submitted',
              submittedAt: new Date()
            });

          res.status(201).json({
            data: application
          });
        } catch (error) {
          next(error);
        }
      },

      async update(req, res, next) {
        try {
          const id = checkedId(
            req.params.applicationId
          );

          const input = parseBody(
            schemas.applicationUpdate,
            req.body
          );

          const filter = {
            ...applicationScope(req.user),
            _id: id
          };

          const existing =
            await models.applications
              .findOne(filter)
              .lean();

          if (!existing) {
            throw httpError(
              404,
              'Application not found or inaccessible.'
            );
          }

          const owner = sameId(
            existing.adopterId,
            req.user._id
          );

          const { status, ...details } = input;
          const hasDetails =
            Object.keys(details).length > 0;

          if (hasDetails && !owner) {
            throw httpError(
              403,
              'Only the applicant may edit application details.'
            );
          }

          if (
            hasDetails &&
            existing.status !== 'submitted'
          ) {
            throw httpError(
              409,
              'Details can only be edited before review.'
            );
          }

          const update = { ...details };

          if (status === 'withdrawn') {
            if (!owner) {
              throw httpError(
                403,
                'Only the applicant may withdraw an application.'
              );
            }

            if (
              !['submitted', 'underReview']
                .includes(existing.status)
            ) {
              throw httpError(
                409,
                'This application cannot be withdrawn.'
              );
            }

            update.status = status;
          } else if (status) {
            if (
              !canReview(req.user, existing) ||
              owner
            ) {
              throw httpError(
                403,
                'A different administrator or assigned staff member must review this application.'
              );
            }

            const transitions = {
              submitted: [
                'underReview',
                'approved',
                'rejected'
              ],
              underReview: [
                'approved',
                'rejected'
              ]
            };

            if (
              !transitions[existing.status]
                ?.includes(status)
            ) {
              throw httpError(
                409,
                'Invalid application status transition.'
              );
            }

            update.status = status;
            update.reviewedBy = req.user._id;
            update.reviewedAt = new Date();
          }

          const application =
            await models.applications.findOneAndUpdate(
              {
                ...filter,
                status: existing.status
              },
              { $set: update },
              {
                returnDocument: 'after',
                runValidators: true
              }
            );

          if (!application) {
            throw httpError(
              409,
              'Application changed or was removed. Refresh and retry.'
            );
          }

          res.json({
            data: application
          });
        } catch (error) {
          next(error);
        }
      },

      async remove(req, res, next) {
        try {
          const id = checkedId(
            req.params.applicationId
          );

          const filter = {
            ...applicationScope(req.user),
            _id: id
          };

          const existing =
            await models.applications
              .findOne(filter)
              .lean();

          if (!existing) {
            throw httpError(
              404,
              'Application not found or inaccessible.'
            );
          }

          if (existing.status === 'approved') {
            throw httpError(
              409,
              'Approved applications must be retained.'
            );
          }

          const ownerMayDelete =
            sameId(existing.adopterId, req.user._id) &&
            ['submitted', 'withdrawn']
              .includes(existing.status);

          if (
            !ownerMayDelete &&
            !canReview(req.user, existing)
          ) {
            throw httpError(
              403,
              'You may only delete your submitted or withdrawn applications.'
            );
          }

          const deleted =
            await models.applications.findOneAndDelete({
              ...filter,
              status: existing.status
            });

          if (!deleted) {
            throw httpError(
              409,
              'Application changed or was removed. Refresh and retry.'
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

module.exports = {
  createWeek6Controllers
};