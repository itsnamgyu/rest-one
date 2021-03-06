const passport = require('passport');
const fs = require('fs');
const LocalStrategy = require('passport-local').Strategy;
const GitHubStrategy = require('passport-github').Strategy;
const BearerStrategy = require('passport-http-bearer').Strategy;
const ClientPasswordStrategy = require('passport-oauth2-client-password').Strategy;

const User = require('./db/user');
const Token = require('./db/oauth_token');

let initialized = false;

function init() {
    if (initialized) {
        console.log('duplicate call to passport.init()');
    } else {
        const keys = JSON.parse(fs.readFileSync('./keys.json').toString());

        passport.use('local', new LocalStrategy({
            usernameField: 'email',
            passwordField: 'password',
        }, (email, password, done) => {
            User.loginUser(email, password)
                .then(user => {
                    done(null, user);
                })
                .catch(e => {
                    if (e instanceof User.AuthenticationError) {
                        console.log(e);
                        done(null, false, { message: 'Invalid email or password' });
                    } else {
                        done(e, false);
                    }
                });
        }));
        passport.use('github', new GitHubStrategy({
                clientID: keys.github.clientID,
                clientSecret: keys.github.clientSecret,
                callbackURL: 'http://localhost:3000/user/auth/github/callback'
            }, (accessToken, refreshToken, profile, cb) => {
                let name = null;
                let email = null;

                if ('displayName' in profile) {
                    name = profile.displayName;
                } else {
                    console.error('[warning] profile.displayName does not exist in GitHub auth callback');
                }

                if (profile.emails.length > 0) {
                    email = profile.emails[0].value;
                }

                return Promise.resolve()
                    .then(() => {
                        // Find user associated with GitHub credential
                        console.log('Finding user via credential...');
                        return User.findUserByCredential(profile.id, profile.provider)
                    })
                    .then(user => {
                        if (user) {
                            // GitHub credential is already added to the user: all done
                            // Log in with that user immediately and end chain
                            console.log('User found with credential: ' + profile.id + ' from ' + profile.provider);
                            console.log('Login: ');
                            console.log(user);
                            cb(null, user);
                            throw null;
                        } else {
                            // If not, check if user with the same email exists
                            console.log('Finding user via email...');
                            return User.findUserByEmail(email);
                        }
                    })
                    .then(user => {
                        if (user) {
                            // If found, proceed to next chain
                            console.log('User found with email: ' + email);
                            return user;
                        } else {
                            // If not, create new user
                            console.log('Creating new user...');
                            return User.createUser(email, null, name);
                        }
                    })
                    .then(user => {
                        // Add GitHub credentials to user
                        console.log('Adding credentials...');
                        return User.addCredential(user.id, profile.id, profile.provider)
                            .then(() => {
                                return user;
                            })
                    })
                    .then(user => {
                        // Log in with that user
                        console.log('Login: ');
                        console.log(user);
                        cb(null, user);
                    })
                    .catch(e => {
                        if (e) {
                            console.error(e, e.stack);
                            cb(e, null);
                        }
                    })
            }
        ));
        passport.use('oauth2-client-password', new ClientPasswordStrategy((clientId, clientSecret, done) => {
            // TODO: verify clientId and clientSecret
            throw new Error('Not implemented');
        }));
        /*
            Verifies Bearer token sent in ANY one of these formats

            1. HTTP Header
                Authentication: Bearer <token>
            2. GET query parameter
                access_token=<token>
            3. POST body
                access_token: <token>
            
            As specified in the Oauth2.0 Bearer Token specs
            Technically, the specs say that the POST methods can only be used when
                Content-Type: application/x-www-form-urlencoded, per spec)
        */
        passport.use('bearer', new BearerStrategy(
            function(token, done) {
                Token.getTokenByValue(token)
                    .then(token => {
                        if (token == null) {
                            done(null, null);
                            return Promise.reject(null);
                        } else {
                            return User.findUserById(token.user_id);
                        }
                    })
                    .then(user => {
                        if (user == null) {
                            console.error('no user associated with token');
                            console.trace();
                            done('server error');
                        } else {
                            done(null, user);
                        }
                    })
                    .catch(e => {
                        if (e) {
                            done(e);
                        }
                    });
            }));
        initialized = true;
    }
}

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    User.findUserById(id)
        .then(user => {
            console.log(user);
            done(null, user);
        })
        .catch(e => {
            done(e, null);
        });
});

module.exports = {
    passport,
    init,
};
