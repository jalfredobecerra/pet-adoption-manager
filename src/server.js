require('dotenv').config();

const mongoose = require('mongoose');
const { MongoStore } = require('connect-mongo');

const models = require('./models');
const { createPassport } = require('./config/passport');
const { createApp } = require('./app');

async function start() {
  const required = [
    'MONGODB_URI',
    'SESSION_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'BASE_URL'
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing environment variable: ${key}`);
    }
  }

  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters.');
  }

  process.env.BASE_URL =
    process.env.BASE_URL.replace(/\/$/, '');

  const production = process.env.NODE_ENV === 'production';
  const baseUrl = new URL(process.env.BASE_URL);

  if (production && baseUrl.protocol !== 'https:') {
    throw new Error('Production BASE_URL must use HTTPS.');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  // Create the four collections and initialize their indexes.
  await Promise.all(
    Object.values(models).map((Model) => Model.init())
  );

  console.log('MongoDB connected.');

  const store = MongoStore.create({
    client: mongoose.connection.getClient(),
    collectionName: 'sessions'
  });

  store.on('error', () => {
    console.error('Session storage failed.');
  });

  const passport = createPassport(models.users, process.env);

  const app = createApp({
    models,
    passport,
    store,
    secret: process.env.SESSION_SECRET,
    production,
    dbReady: () => mongoose.connection.readyState === 1
  });

  const port = Number(process.env.PORT || 3000);

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`API running at ${process.env.BASE_URL}`);
    console.log(`Swagger: ${process.env.BASE_URL}/api-docs`);
  });

  function shutdown() {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  }

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

start().catch(async (error) => {
  console.error('Startup failed:', {
    name: error.name,
    code: error.code ?? error.cause?.code,
    codeName: error.codeName ?? error.cause?.codeName
  });

  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});