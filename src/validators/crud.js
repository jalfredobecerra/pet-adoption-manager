const { z } = require('zod');
const { httpError } = require('../middleware/security');

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Use a valid MongoDB ObjectId.');

const text = (maximum, minimum = 1) =>
  z.string().trim().min(minimum).max(maximum);

const shelterFields = {
  name: text(120, 2),
  description: text(2000),
  contactEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .toLowerCase(),
  phone: text(30),
  streetAddress: text(200),
  city: text(100),
  stateOrRegion: text(100),
  postalCode: text(20)
};

const petFields = {
  name: text(80, 2),
  species: z.enum([
    'dog',
    'cat',
    'rabbit',
    'bird',
    'other'
  ]),
  breed: text(100),
  ageMonths: z.number().int().nonnegative(),
  sex: z.enum(['male', 'female', 'unknown']),
  description: text(2000),
  adoptionStatus: z
    .enum(['available', 'pending', 'adopted'])
    .optional(),
  shelterId: objectId,
  photoUrl: z
    .string()
    .trim()
    .max(1000)
    .url()
    .regex(/^https?:\/\//, 'Use an HTTP or HTTPS URL.')
    .optional()
};

const shelterCreate = z
  .object(shelterFields)
  .strict();

const shelterUpdate = z
  .object(shelterFields)
  .partial()
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    'Supply at least one field to update.'
  );

const petCreate = z
  .object(petFields)
  .strict();

const petUpdate = z
  .object(petFields)
  .partial()
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    'Supply at least one field to update.'
  );

function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'body',
      message: issue.message
    }));

    throw httpError(400, 'Request validation failed.', details);
  }

  return result.data;
}

module.exports = {
  shelterCreate,
  shelterUpdate,
  petCreate,
  petUpdate,
  parseBody
};