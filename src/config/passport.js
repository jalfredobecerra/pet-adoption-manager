const { Passport } = require('passport');
const GoogleStrategy =
  require('passport-google-oauth20').Strategy;

function createPassport(User, env) {
  const passport = new Passport();

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${env.BASE_URL}/auth/google/callback`,
        state: true
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;

          if (!profile.id || !email) {
            return done(
              Object.assign(
                new Error('Google did not provide a usable profile.'),
                { status: 401 }
              )
            );
          }

          const identity = {
            oauthProvider: 'google',
            providerId: profile.id,
            displayName: profile.displayName,
            email
          };

          done(null, identity);
        } catch (error) {
          done(error);
        }
      }
    )
  );

  passport.serializeUser((identity, done) => {
    done(null, identity);
  });

  passport.deserializeUser(async (identity, done) => {
    try {
      const user = await User.findOne({
        oauthProvider: identity.oauthProvider,
        providerId: identity.providerId
      }).lean();

      // New identities remain restricted until POST /api/users.
      done(null, user || identity);
    } catch (error) {
      done(error);
    }
  });

  return passport;
}

module.exports = { createPassport };