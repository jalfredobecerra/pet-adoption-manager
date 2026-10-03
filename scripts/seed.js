require('dotenv').config();

const mongoose = require('mongoose');
const models = require('../src/models');
const { isId } = require('../src/controllers/read');

async function seed() {
  const userId = process.argv[2];

  if (!isId(userId)) {
    throw new Error(
      'Usage: npm run seed -- YOUR_AUTHENTICATED_USER_ID'
    );
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required.');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  await Promise.all(
    Object.values(models).map((Model) => Model.init())
  );

  const user = await models.users.findById(userId);

  if (!user) {
    throw new Error('Sign in and create your profile first.');
  }

  const shelterId = new mongoose.Types.ObjectId(
    '507f1f77bcf86cd799439011'
  );

  const petId = new mongoose.Types.ObjectId(
    '507f1f77bcf86cd799439012'
  );

  await models.shelters.updateOne(
    { _id: shelterId },
    {
      $setOnInsert: {
        name: 'Example Animal Shelter',
        description: 'Demonstration data for the course project.',
        contactEmail: 'contact@example.invalid',
        phone: '555-0100',
        streetAddress: '100 Example Street',
        city: 'Example City',
        stateOrRegion: 'Example Region',
        postalCode: '00000'
      }
    },
    { upsert: true, runValidators: true }
  );

  await models.pets.updateOne(
    { _id: petId },
    {
      $setOnInsert: {
        name: 'Luna',
        species: 'dog',
        breed: 'Mixed breed',
        ageMonths: 18,
        sex: 'female',
        description: 'A friendly demonstration pet.',
        adoptionStatus: 'available',
        shelterId
      }
    },
    { upsert: true, runValidators: true }
  );

  await models.applications.updateOne(
    { petId, adopterId: user._id },
    {
      $setOnInsert: {
        shelterId,
        contactPhone: '555-0101',
        housingType: 'house',
        hasOtherPets: false,
        motivation: 'I can provide a suitable home for this pet.',
        status: 'submitted',
        submittedAt: new Date()
      }
    },
    { upsert: true, runValidators: true }
  );

  console.log('Demonstration records are ready.');
  console.log(`Shelter ID: ${shelterId}`);
  console.log(`Pet ID: ${petId}`);
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });