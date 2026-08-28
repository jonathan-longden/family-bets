/* The name, in one place.

   The working name swears. That is deliberate, and it is also the single most
   likely thing to change — a shop front will not carry it — so nothing else in
   the app hardcodes it. Rename here and the header, the About sheet, the page
   title and the share card all follow.

   The two names are not a censor and its victim: `clean` is a name in its own
   right rather than the sweary one with the teeth pulled. Which one shows
   follows the swearing setting, so a phone handed across the breakfast table
   does not announce itself.

   Candidates parked for later, when a shop front needs one: Bloody Weather,
   Weather You Legend, What The Weather, Proper Weather. */

(function (root) {
  'use strict';

  root.Brand = {
    name: 'Fucking Weather',
    clean: 'Blooming Weather',

    tagline: 'A proper weather app that tells you exactly what the sky is doing, then takes the mickey out of it.',

    /* manifest.json carries its own copy of the name — it is JSON on disk and
       cannot read this file. The README lists every place a rename touches. */
    pick: function (sweary) { return sweary === false ? this.clean : this.name; },

    /* For the share card, where the joke belongs to the weather rather than
       the app: a quiet signature rather than a shout. */
    signature: function (sweary) { return this.pick(sweary).toUpperCase(); }
  };

})(typeof self !== 'undefined' ? self : this);
