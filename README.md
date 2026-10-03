# Pet Adoption Manager API

A Node.js REST API for pet listings, shelters, user profiles, and adoption applications.

## Current milestone

Week 5 includes:
- MongoDB Atlas connection
- Four database collections
- Google OAuth authentication
- Profile onboarding
- Public and protected GET routes
- GET route unit tests
- Interactive Swagger documentation

Remaining collection write operations are documented as planned for Week 6 and currently return 501.

## Setup

1. Install Node.js 24.
2. Run npm ci.
3. Copy .env.example to .env.
4. Configure MongoDB and Google OAuth credentials.
5. Run npm run dev.
6. Open http://localhost:3000/api-docs.

## Authentication

Open /auth/google in a browser.

After sign-in:
1. Call GET /auth/me.
2. Get GET /auth/csrf.
3. Set the X-CSRF-Token through Swagger Authorize.
4. If onboarding is required, call POST /api/users.

The browser manages the HttpOnly session cookie.

## Tests

npm test

npm run test:coverage

Tests mock MongoDB and Passport. Verify the real database connection and Google login manually.

## Demonstration data

After creating a user profile:

npm run seed -- YOUR_USER_ID

## Collections

- users
- shelters
- pets
- applications

The sessions collection stores operational login sessions.

## Documentation

Local: http://localhost:3000/api-docs

Deployment: REPLACE_WITH_YOUR_RENDER_URL/api-docs

## Deployment

Provider: Render

Build command: npm ci

Start command: npm start

Health check: /health

## Contributions

See CONTRIBUTIONS.md.