const resources = require('../src/resources');

const ref = (name) => ({
  $ref: `#/components/schemas/${name}`
});

const id = {
  type: 'string',
  pattern: '^[a-fA-F0-9]{24}$',
  example: '507f1f77bcf86cd799439011'
};

const string = (maxLength, example) => ({
  type: 'string',
  maxLength,
  example
});

const enumeration = (values) => ({
  type: 'string',
  enum: values,
  example: values[0]
});

const timestamp = {
  type: 'string',
  format: 'date-time',
  readOnly: true
};

const properties = {
  User: {
    displayName: {
      ...string(80, 'Julian Becerra'),
      minLength: 2
    },
    role: enumeration(['adopter', 'shelterStaff', 'admin']),
    shelterId: id
  },

  Shelter: {
    name: string(120, 'Example Animal Shelter'),
    description: string(2000, 'A demonstration shelter.'),
    contactEmail: {
      type: 'string',
      format: 'email',
      maxLength: 254,
      example: 'contact@example.invalid'
    },
    phone: string(30, '555-0100'),
    streetAddress: string(200, '100 Example Street'),
    city: string(100, 'Example City'),
    stateOrRegion: string(100, 'Example Region'),
    postalCode: string(20, '00000')
  },

  Pet: {
    name: string(80, 'Luna'),
    species: enumeration(['dog', 'cat', 'rabbit', 'bird', 'other']),
    breed: string(100, 'Mixed breed'),
    ageMonths: {
      type: 'integer',
      minimum: 0,
      example: 18
    },
    sex: enumeration(['male', 'female', 'unknown']),
    description: string(2000, 'A friendly demonstration pet.'),
    adoptionStatus: enumeration(['available', 'pending', 'adopted']),
    shelterId: id,
    photoUrl: {
      type: 'string',
      format: 'uri',
      pattern: '^https?://',
      maxLength: 1000,
      example: 'https://example.com/luna.jpg'
    }
  },

  Application: {
    petId: id,
    adopterId: id,
    shelterId: id,
    contactPhone: string(30, '555-0101'),
    housingType: enumeration(['house', 'apartment', 'other']),
    hasOtherPets: {
      type: 'boolean',
      example: false
    },
    motivation: {
      ...string(2000, 'I can provide a suitable home for this pet.'),
      minLength: 10
    },
    status: enumeration([
      'submitted',
      'underReview',
      'approved',
      'rejected',
      'withdrawn'
    ]),
    submittedAt: timestamp,
    reviewedBy: id,
    reviewedAt: timestamp
  }
};

function object(properties, required = []) {
  return {
    type: 'object',
    properties,
    required
  };
}

function jsonResponse(description, schema) {
  return {
    description,
    content: {
      'application/json': { schema }
    }
  };
}

const errorResponse = (description) =>
  jsonResponse(description, ref('Error'));

const commonErrors = {
  400: errorResponse('Invalid ID, query, or request data.'),
  401: errorResponse('Google sign-in is required.'),
  403: errorResponse('Access denied or invalid CSRF token.'),
  500: errorResponse('Unexpected server or database failure.')
};

const sessionSecurity = [{ sessionCookie: [] }];

const writeSecurity = [
  { sessionCookie: [], csrfToken: [] }
];

const access = {
  users:
    'Lists require an administrator. Individual reads allow the owner or an administrator. OAuth identifiers and email are omitted from these GET responses.',
  shelters:
    'Public reads. Planned creates and deletes require an administrator; updates allow assigned shelter staff or an administrator.',
  pets:
    'Public reads. Planned writes allow staff of the owning shelter or an administrator.',
  applications:
    'Reads are limited to the adopter, assigned shelter staff, or an administrator. Inaccessible individual records return 404. Planned create operations allow adopters; reviews require assigned staff or an administrator.'
};

const requiredInputs = {
  Shelter: [
    'name',
    'description',
    'contactEmail',
    'phone',
    'streetAddress',
    'city',
    'stateOrRegion',
    'postalCode'
  ],
  Pet: [
    'name',
    'species',
    'breed',
    'ageMonths',
    'sex',
    'description',
    'shelterId'
  ],
  Application: [
    'petId',
    'contactPhone',
    'housingType',
    'hasOtherPets',
    'motivation'
  ]
};

module.exports = function buildOpenApi() {
  const schemas = {
    Error: object({
      error: object(
        {
          status: { type: 'integer', example: 400 },
          message: {
            type: 'string',
            example: 'Invalid document ID.'
          }
        },
        ['status', 'message']
      )
    }),

    UserCreate: {
      ...object({
        displayName: properties.User.displayName
      }),
      additionalProperties: false
    },

    Csrf: object({
      csrfToken: {
        type: 'string',
        example: 'copy-the-token-returned-by-this-endpoint'
      }
    }),

    Health: object({
      status: enumeration(['ok', 'unavailable']),
      database: enumeration(['connected', 'disconnected'])
    })
  };

  for (const [name, fields] of Object.entries(properties)) {
    schemas[name] = object({
      _id: { ...id, readOnly: true },
      ...fields,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    if (name !== 'User') {
      const writable = { ...fields };

      if (name === 'Application') {
        for (const field of [
          'adopterId',
          'shelterId',
          'status',
          'submittedAt',
          'reviewedBy',
          'reviewedAt'
        ]) {
          delete writable[field];
        }
      }

      schemas[`${name}Create`] = {
        ...object(writable, requiredInputs[name]),
        additionalProperties: false
      };
    }

    schemas[`${name}Update`] = {
      ...object(
        name === 'Application'
          ? {
              contactPhone: fields.contactPhone,
              housingType: fields.housingType,
              hasOtherPets: fields.hasOtherPets,
              motivation: fields.motivation,
              status: fields.status
            }
          : fields
      ),
      minProperties: 1,
      additionalProperties: false
    };
  }

  const paths = {};

  for (const [resource, settings] of Object.entries(resources)) {
    const collectionPath = `/api/${resource}`;
    const itemPath = `${collectionPath}/{${settings.idParam}}`;
    const isPublic = ['pets', 'shelters'].includes(resource);

    const itemParameter = {
      name: settings.idParam,
      in: 'path',
      required: true,
      schema: id,
      description: 'MongoDB document identifier.'
    };

    const queryParameters = [
      {
        name: 'page',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 10000,
          default: 1
        }
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20
        }
      }
    ];

    if (resource === 'pets') {
      queryParameters.push(
        {
          name: 'species',
          in: 'query',
          schema: properties.Pet.species
        },
        {
          name: 'status',
          in: 'query',
          schema: properties.Pet.adoptionStatus
        },
        {
          name: 'shelterId',
          in: 'query',
          schema: id
        }
      );
    }

    paths[collectionPath] = {
      get: {
        tags: [settings.schema],
        operationId: `list${settings.schema}`,
        summary: `List ${resource}`,
        description: `${access[resource]} Results are paginated and ordered by ID. Unsupported query parameters return 400.`,
        security: isPublic ? [] : sessionSecurity,
        parameters: queryParameters,
        responses: {
          200: jsonResponse(
            'Records visible to the current caller; data may be empty.',
            object({
              data: {
                type: 'array',
                items: ref(settings.schema)
              },
              page: { type: 'integer' },
              limit: { type: 'integer' }
            })
          ),
          ...commonErrors
        }
      }
    };

    paths[itemPath] = {
      get: {
        tags: [settings.schema],
        operationId: `get${settings.schema}`,
        summary: `Get one ${settings.schema.toLowerCase()}`,
        description: access[resource],
        security: isPublic ? [] : sessionSecurity,
        parameters: [itemParameter],
        responses: {
          200: jsonResponse(
            'One visible record.',
            object({ data: ref(settings.schema) })
          ),
          404: errorResponse('Record not found or outside caller scope.'),
          ...commonErrors
        }
      }
    };

    for (const method of ['post', 'put', 'delete']) {
      const onboarding =
        resource === 'users' && method === 'post';

      const destination =
        method === 'post'
          ? paths[collectionPath]
          : paths[itemPath];

      const operation = {
        tags: [settings.schema],
        operationId: `${method}${settings.schema}`,
        summary: onboarding
          ? 'Complete your OAuth profile'
          : `[Week 6 planned] ${method.toUpperCase()} ${resource}`,
        description: onboarding
          ? 'Creates the current verified OAuth identity’s profile. Optional displayName may be supplied. Identity, email, and adopter role come from the server. A second creation attempt returns 409.'
          : `Current Week 5 implementation returns 501 after session and CSRF checks. Planned behavior: ${access[resource]} PUT updates permitted fields. Application status changes must follow ownership and review rules. Deletes must preserve referenced records.`,
        'x-implementation-status': onboarding ? 'implemented' : 'planned',
        security: writeSecurity,
        parameters: method === 'post' ? [] : [itemParameter],
        responses: {
          ...commonErrors,
          409: errorResponse('Duplicate profile or planned relationship conflict.')
        }
      };

      if (onboarding) {
        operation.responses[201] = jsonResponse(
          'Profile created.',
          object({ data: ref('User') })
        );
      } else {
        operation.responses[501] = errorResponse(
          'Current Week 5 response: operation is planned for Week 6.'
        );

        const futureStatus =
          method === 'post' ? 201 : method === 'put' ? 200 : 204;

        operation.responses[futureStatus] =
          method === 'delete'
            ? { description: 'Planned Week 6 deletion success.' }
            : jsonResponse(
                'Planned Week 6 success response.',
                object({ data: ref(settings.schema) })
              );

        operation.responses[404] = errorResponse(
          'Planned Week 6 response when the record does not exist.'
        );
      }

      if (method !== 'delete') {
        operation.requestBody = {
          required: !onboarding,
          content: {
            'application/json': {
              schema: ref(
                `${settings.schema}${method === 'post' ? 'Create' : 'Update'}`
              )
            }
          }
        };
      }

      destination[method] = operation;
    }
  }

  paths['/auth/google'] = {
    get: {
      tags: ['Authentication'],
      summary: 'Start Google sign-in',
      description: 'Open this route in a browser. Do not start the OAuth redirect flow through Try it out.',
      security: [],
      responses: {
        302: { description: 'Redirect to Google with OAuth state.' },
        500: commonErrors[500]
      }
    }
  };

  paths['/auth/google/callback'] = {
    get: {
      tags: ['Authentication'],
      summary: 'Receive the Google OAuth callback',
      description: 'Google invokes this route. Passport validates OAuth state and authenticates the Google identity.',
      security: [],
      parameters: [
        {
          name: 'code',
          in: 'query',
          schema: { type: 'string' }
        },
        {
          name: 'state',
          in: 'query',
          schema: { type: 'string' }
        },
        {
          name: 'error',
          in: 'query',
          schema: { type: 'string' }
        }
      ],
      responses: {
        302: { description: 'Login established; redirect to /api-docs.' },
        400: commonErrors[400],
        401: commonErrors[401],
        403: commonErrors[403],
        500: commonErrors[500]
      }
    }
  };

  paths['/auth/me'] = {
    get: {
      tags: ['Authentication'],
      summary: 'Get the current identity or profile',
      security: sessionSecurity,
      responses: {
        200: jsonResponse(
          'Current account. New identities have needsOnboarding=true and no local _id or role.',
          object({
            data: object({
              ...schemas.User.properties,
              email: {
                type: 'string',
                format: 'email'
              }
            }),
            needsOnboarding: { type: 'boolean' }
          })
        ),
        401: commonErrors[401],
        500: commonErrors[500]
      }
    }
  };

  paths['/auth/csrf'] = {
    get: {
      tags: ['Authentication'],
      summary: 'Get a CSRF token',
      description: 'Copy csrfToken into Authorize → csrfToken before using a protected write operation. Get a new token after signing in again.',
      security: sessionSecurity,
      responses: {
        200: jsonResponse('CSRF token for this session.', ref('Csrf')),
        401: commonErrors[401],
        500: commonErrors[500]
      }
    }
  };

  paths['/auth/logout'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Sign out',
      security: writeSecurity,
      responses: {
        204: { description: 'Session destroyed and cookie cleared.' },
        401: commonErrors[401],
        403: commonErrors[403],
        500: commonErrors[500]
      }
    }
  };

  paths['/health'] = {
    get: {
      tags: ['System'],
      summary: 'Check service and database readiness',
      security: [],
      responses: {
        200: jsonResponse('MongoDB is connected.', ref('Health')),
        503: jsonResponse('MongoDB is disconnected.', ref('Health'))
      }
    }
  };

  paths['/'] = {
    get: {
      tags: ['System'],
      summary: 'Open the documentation',
      security: [],
      responses: {
        302: { description: 'Redirect to /api-docs.' }
      }
    }
  };

  paths['/api-docs'] = {
    get: {
      tags: ['System'],
      summary: 'Open Swagger UI',
      security: [],
      responses: {
        200: {
          description: 'Swagger HTML interface.',
          content: {
            'text/html': {
              schema: { type: 'string' }
            }
          }
        },
        301: { description: 'Normalize the trailing slash.' }
      }
    }
  };

  paths['/api-docs.json'] = {
    get: {
      tags: ['System'],
      summary: 'Get the OpenAPI specification',
      security: [],
      responses: {
        200: jsonResponse(
          'OpenAPI 3 specification.',
          { type: 'object' }
        )
      }
    }
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Pet Adoption Manager API',
      version: '0.1.0',
      description: [
        'Week 5 implementation.',
        '',
        '[Sign in with Google](/auth/google), then return here.',
        'Use GET /auth/me to check your session.',
        'New users must get a CSRF token and call POST /api/users.',
        '',
        'Public pet and shelter reads are available without login.',
        'Protected requests use the browser’s same-origin session cookie.',
        'For writes, obtain GET /auth/csrf and authorize csrfToken.',
        '',
        'Operations labeled Week 6 planned currently return 501.'
      ].join('\n')
    },
    servers: [
      {
        url: '/',
        description: 'The current local or Render server'
      }
    ],
    tags: [
      ...Object.values(resources).map((value) => ({
        name: value.schema
      })),
      { name: 'Authentication' },
      { name: 'System' }
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'pa.sid',
          description: 'Created by Google sign-in. The browser manages this HttpOnly cookie; do not paste a cookie value into Swagger.'
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-CSRF-Token',
          description: 'Token returned by GET /auth/csrf.'
        }
      },
      schemas
    },
    paths
  };
};