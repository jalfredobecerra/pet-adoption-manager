const mongoose = require('mongoose');

const { Schema } = mongoose;

const text = (maxLength, required = true) => ({
  type: String,
  trim: true,
  required,
  maxlength: maxLength
});

const reference = (model, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required
});

const email = {
  ...text(254),
  lowercase: true,
  match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
};

const options = {
  timestamps: true,
  versionKey: false
};

const userSchema = new Schema(
  {
    oauthProvider: {
      type: String,
      enum: ['google'],
      required: true
    },
    providerId: text(200),
    displayName: {
      ...text(80),
      minlength: 2
    },
    email,
    role: {
      type: String,
      enum: ['adopter', 'shelterStaff', 'admin'],
      default: 'adopter',
      required: true
    },
    shelterId: reference('Shelter', false)
  },
  options
);

userSchema.index(
  { oauthProvider: 1, providerId: 1 },
  { unique: true }
);

const shelterSchema = new Schema(
  {
    name: text(120),
    description: text(2000),
    contactEmail: email,
    phone: text(30),
    streetAddress: text(200),
    city: text(100),
    stateOrRegion: text(100),
    postalCode: text(20)
  },
  options
);

const petSchema = new Schema(
  {
    name: text(80),
    species: {
      type: String,
      enum: ['dog', 'cat', 'rabbit', 'bird', 'other'],
      required: true
    },
    breed: text(100),
    ageMonths: {
      type: Number,
      min: 0,
      required: true,
      validate: Number.isInteger
    },
    sex: {
      type: String,
      enum: ['male', 'female', 'unknown'],
      required: true
    },
    description: text(2000),
    adoptionStatus: {
      type: String,
      enum: ['available', 'pending', 'adopted'],
      default: 'available',
      required: true
    },
    shelterId: reference('Shelter'),
    photoUrl: {
      ...text(1000, false),
      match: /^https?:\/\/\S+$/
    }
  },
  options
);

petSchema.index({ shelterId: 1, adoptionStatus: 1 });

const applicationSchema = new Schema(
  {
    petId: reference('Pet'),
    adopterId: reference('User'),
    shelterId: reference('Shelter'),
    contactPhone: text(30),
    housingType: {
      type: String,
      enum: ['house', 'apartment', 'other'],
      required: true
    },
    hasOtherPets: {
      type: Boolean,
      required: true
    },
    motivation: {
      ...text(2000),
      minlength: 10
    },
    status: {
      type: String,
      enum: [
        'submitted',
        'underReview',
        'approved',
        'rejected',
        'withdrawn'
      ],
      default: 'submitted',
      required: true
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    reviewedBy: reference('User', false),
    reviewedAt: Date
  },
  options
);

applicationSchema.index(
  { petId: 1, adopterId: 1 },
  { unique: true }
);

applicationSchema.index({ adopterId: 1 });
applicationSchema.index({ shelterId: 1 });

module.exports = {
  users: mongoose.model('User', userSchema, 'users'),
  shelters: mongoose.model('Shelter', shelterSchema, 'shelters'),
  pets: mongoose.model('Pet', petSchema, 'pets'),
  applications: mongoose.model(
    'Application',
    applicationSchema,
    'applications'
  )
};