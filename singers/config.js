/* Spotlight backend configuration.
 *
 * Leave this as null and the app runs exactly as it does today: local-first,
 * one isolated world per device, no sign-in. Useful for demos and development.
 *
 * Fill it in with your Firebase web config and the app becomes a real service:
 * everyone who installs it lands in the same room, signs in with Google or
 * Apple, and the security rules in firebase/ start enforcing who can read
 * what. See firebase/README.md for the setup, which takes about ten minutes.
 *
 * These values are not secrets — Firebase web configs are public by design,
 * and the security rules are what actually protect the data.
 */
window.SPOTLIGHT_CONFIG = null;

/* Example:
window.SPOTLIGHT_CONFIG = {
  apiKey: 'AIza…',
  authDomain: 'spotlight-xxxx.firebaseapp.com',
  databaseURL: 'https://spotlight-xxxx-default-rtdb.firebaseio.com',
  projectId: 'spotlight-xxxx',
  storageBucket: 'spotlight-xxxx.appspot.com',
  messagingSenderId: '…',
  appId: '1:…:web:…',
};
*/
