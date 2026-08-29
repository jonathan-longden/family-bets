/* The name, in one place.

   GENERATED FROM app.config.json — edit that and run `npm run config` in
   mobile/. Changing this file by hand works until the next build wipes it.

   One name, whatever the swearing setting says. The app used to rename itself
   when swearing was switched off, back when its own name was the rudest thing
   about it. It is not any more: the name is respectable and the mouth is not,
   which is the joke. The setting changes what the app says, never what it is
   called. */

(function (root) {
  'use strict';

  root.Brand = {
    name: "Blooming Weather",

    /* What the two shops are told, which is normally the same thing — their
       listing rules occasionally want it not to be. */
    store: "Blooming Weather",

    tagline: "A proper weather app that tells you exactly what the sky is doing, then takes the mickey out of it.",

    version: "1.0.0",
    build: "6",

    /* For the share card, where the joke belongs to the weather rather than
       the app: a quiet signature rather than a shout. */
    signature: function () { return this.name.toUpperCase(); }
  };

})(typeof self !== 'undefined' ? self : this);
