const buildWeek5 = require('./openapi');

const ref = (name) => ({
  $ref: `#/components/schemas/${name}`
});

const json = (description, schema) => ({
  description,
  content: {
    'application/json': { schema }
  }
});

const error = (description) =>
  json(description, ref('Error'));

module.exports = function buildWeek6() {
  const spec = JSON.parse(
    JSON.stringify(buildWeek5())
  );

  spec.info.version = '0.3.0';

  spec.info.description = [
    'Pet Adoption Manager: CRUD for users, shelters, pets, and applications.',
    'Open /auth/google in your browser to sign in. Inspect /auth/me.',
    'New Google identities complete POST /api/users; role defaults to adopter.',
    'Get /auth/csrf and enter the token in Authorize -> csrfToken before writes.',
    'The browser sends the HttpOnly session cookie automatically.',
    'Every POST, PUT, and DELETE requires authentication and a CSRF token.',
    'POST and PUT allowlist and validate fields. PUT updates supplied fields.',
    'Application approval records a review decision. It does not automatically',
    'change the pet adoptionStatus; authorized staff manage that through PUT /api/pets/{petId}.',
    'Only non-administrator profiles without application references can be deleted.'
  ].join('\n');

  const schemas = spec.components.schemas;

  const id = {
    type: 'string',
    pattern: '^[a-fA-F0-9]{24}$'
  };

  schemas.UserUpdate = {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      displayName: {
        type: 'string',
        minLength: 2,
        maxLength: 80
      },
      role: {
        type: 'string',
        enum: [
          'adopter',
          'shelterStaff',
          'admin'
        ]
      },
      shelterId: {
        ...id,
        nullable: true
      }
    }
  };

  schemas.UserWrite = {
    ...schemas.User,
    properties: {
      ...schemas.User.properties,
      email: {
        type: 'string',
        format: 'email'
      }
    }
  };

  for (const name of [
    'Application',
    'ApplicationCreate',
    'ApplicationUpdate'
  ]) {
    schemas[name].properties.contactPhone.minLength = 1;
  }

  schemas.ApplicationUpdate.properties.status.enum = [
    'underReview',
    'approved',
    'rejected',
    'withdrawn'
  ];

  const descriptions = {
    users: {
      get:
        'Administrators may list users. Owners and administrators may read one profile. GET responses omit email and OAuth identifiers.',
      post:
        'Create only your signed-in Google identity profile. Optional displayName; identity and email are server-controlled, and role defaults to adopter. Existing profiles return 409.',
      put:
        'Owners may edit displayName. Administrators may edit other profiles, roles, and shelter assignments. Administrators cannot change their own permissions. shelterStaff requires an existing shelter; other roles cannot have shelter assignments. Omitted fields are preserved, except assignments are cleared when changing to a non-staff role.',
      delete:
        'Owner or administrator. Administrator profiles cannot be deleted. Application adopterId or reviewedBy references block deletion with 409. Deleting a local profile does not delete the Google account; its identity can onboard again.'
    },

    shelters: {
      get:
        'Public reads. Lists are paginated.',
      post:
        'Administrator only. Creates a shelter.',
      put:
        'Administrator or assigned shelter staff. Updates supplied fields.',
      delete:
        'Administrator only. Pets, applications, or assigned users block deletion.'
    },

    pets: {
      get:
        'Public reads. Lists support species, status, shelterId, page, and limit filters.',
      post:
        'Administrator or assigned shelter staff. The referenced shelter must exist.',
      put:
        'Administrator or staff of the current shelter. Only administrators may transfer pets; existing applications block transfers.',
      delete:
        'Administrator or staff of the current shelter. Existing applications block deletion.'
    },

    applications: {
      get:
        'Administrators see all applications; adopters see their own; shelter staff see assigned-shelter applications. Inaccessible individual records return 404.',
      post:
        'Any completed signed-in profile may apply for an available pet. adopterId comes from the session, shelterId from the pet, and status is submitted. One application per pet/adopter pair; duplicates return 409.',
      put:
        'Applicant may edit contactPhone, housingType, hasOtherPets, and motivation only while submitted, or withdraw submitted/underReview applications. A different administrator or assigned staff member may review. submitted -> underReview/approved/rejected; underReview -> approved/rejected. Review changes set reviewedBy and reviewedAt. Final statuses cannot be reopened. Invalid transitions or concurrent status changes return 409.',
      delete:
        'Applicant may delete submitted or withdrawn applications. Administrators and assigned staff may delete non-approved applications. Approved applications are retained; deletion returns 409.'
    }
  };

  const settings = require('../src/resources');

  for (
    const [resource, resourceSettings]
    of Object.entries(settings)
  ) {
    const collection =
      spec.paths[`/api/${resource}`];

    const item =
      spec.paths[
        `/api/${resource}/{${resourceSettings.idParam}}`
      ];

    collection.get.description =
      descriptions[resource].get +
      ' Results are ordered by ID. Unsupported query parameters return 400.';

    item.get.description =
      descriptions[resource].get;

    for (const method of [
      'post',
      'put',
      'delete'
    ]) {
      const operation =
        method === 'post'
          ? collection.post
          : item[method];

      operation.summary =
        `${method.toUpperCase()} ${resource}`;

      operation.description =
        descriptions[resource][method];

      operation['x-implementation-status'] =
        'implemented';

      operation.security = [
        {
          sessionCookie: [],
          csrfToken: []
        }
      ];

      const status =
        method === 'post'
          ? 201
          : method === 'put'
            ? 200
            : 204;

      operation.responses = {
        400: error(
          'Invalid ID, malformed JSON, or validation failure.'
        ),
        401: error(
          'Google sign-in required.'
        ),
        403: error(
          'Profile incomplete, permissions denied, or invalid CSRF token.'
        ),
        409: error(
          'Duplicate, relationship conflict, protected record, invalid transition, or concurrent modification.'
        ),
        500: error(
          'Unexpected server or database failure.'
        ),
        [status]:
          method === 'delete'
            ? {
                description:
                  'Deleted. Empty response body.'
              }
            : json(
                method === 'post'
                  ? 'Created.'
                  : 'Updated.',
                {
                  type: 'object',
                  properties: {
                    data: ref(
                      resource === 'users'
                        ? 'UserWrite'
                        : resourceSettings.schema
                    )
                  }
                }
              )
      };

      if (
        method !== 'post' ||
        ['pets', 'applications'].includes(resource)
      ) {
        operation.responses[404] = error(
          'Record or referenced record not found, or inaccessible application.'
        );
      }

      if (method !== 'delete') {
        operation.requestBody = {
          required: !(
            resource === 'users' &&
            method === 'post'
          ),
          content: {
            'application/json': {
              schema: ref(
                resourceSettings.schema +
                (
                  method === 'post'
                    ? 'Create'
                    : 'Update'
                )
              )
            }
          }
        };
      }
    }
  }

  return spec;
};