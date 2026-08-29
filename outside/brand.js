/* The name, in one place.

   GENERATED FROM app.config.json — edit that and run `npm run config` in
   mobile/. Changing this file by hand works until the next build wipes it.

   The working name swears. That is deliberate, and it is also the single most
   likely thing to change — a shop front will not carry it — so nothing else in
   the app hardcodes it.

   The two names are not a censor and its victim: `clean` is a name in its own
   right rather than the sweary one with the teeth pulled. Which one shows
   follows the swearing setting, so a phone handed across the breakfast table
   does not announce itself. */

(function (root) {
  'use strict';

  root.Brand = {
    name: "Fucking Weather",
    clean: "Blooming Weather",

    /* What the shops call it. Only ever shown in the privacy policy and the
       About sheet's small print, where it has to match the listing. */
    store: "Blooming Weather",

    tagline: "A proper weather app that tells you exactly what the sky is doing, then takes the mickey out of it.",

    version: "1.0.0",
    build: "6",

    pick: function (sweary) { return sweary === false ? this.clean : this.name; },

    /* For the share card, where the joke belongs to the weather rather than
       the app: a quiet signature rather than a shout. */
    signature: function (sweary) { return this.pick(sweary).toUpperCase(); }
  };

})(typeof self !== 'undefined' ? self : this);
