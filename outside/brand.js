/* The name, in one place.

   The working name swears. That is deliberate, and it is also the single most
   likely thing to change — a shop front will not carry it — so nothing else in
   the app hardcodes it. Rename here and the page title, the header, the About
   sheet and the error screens all follow.

   The two names are not a censor and its victim: `clean` is a name in its own
   right, chosen to be funny rather than to be the sweary one with the teeth
   pulled. Which one shows follows the swearing setting, so a phone handed to a
   child at the breakfast table does not announce itself. */

(function (root) {
  'use strict';

  root.Brand = {
    name: 'Bloody Weather',
    clean: 'Blooming Weather',

    /* Shown under the name in About. Same rule: both are real. */
    tagline: 'The weather, and a running commentary.',

    /* What the manifest says. Changing the name for real means editing
       manifest.json too — it is JSON on disk and cannot read this file. The
       README lists the four places. */
    manifestNote: 'manifest.json carries its own copy of the name',

    pick: function (sweary) { return sweary === false ? this.clean : this.name; }
  };

})(typeof self !== 'undefined' ? self : this);
