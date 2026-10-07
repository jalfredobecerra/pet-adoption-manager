const { z } = require('zod');

const id = z.string().regex(
  /^[a-f\d]{24}$/i,
  'Use a valid MongoDB ObjectId.'
);

const text = (max, min = 1) =>
  z.string().trim().min(min).max(max);

const nonempty = (schema) => schema.refine(
  (data) => Object.keys(data).length > 0,
  'Supply at least one field to update.'
);

const userCreate = z.object({
  displayName: text(80, 2).optional()
}).strict();

const userUpdate = nonempty(z.object({
  displayName: text(80, 2).optional(),
  role: z.enum([
    'adopter',
    'shelterStaff',
    'admin'
  ]).optional(),
  shelterId: id.nullable().optional()
}).strict());

const applicationFields = {
  contactPhone: text(30),
  housingType: z.enum([
    'house',
    'apartment',
    'other'
  ]),
  hasOtherPets: z.boolean(),
  motivation: text(2000, 10)
};

const applicationCreate = z.object({
  petId: id,
  ...applicationFields
}).strict();

const applicationUpdate = nonempty(z.object({
  ...applicationFields,
  status: z.enum([
    'underReview',
    'approved',
    'rejected',
    'withdrawn'
  ])
}).partial().strict());

module.exports = {
  userCreate,
  userUpdate,
  applicationCreate,
  applicationUpdate
};