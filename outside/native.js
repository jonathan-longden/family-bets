/* The native bridge.

   The same app runs in three places: a browser tab, an installed PWA, and a
   real iOS or Android app built with Capacitor. Everything else in this
   project is written as though only the browser existed. This file is the one
   place that knows otherwise.

   On the web every function here is a no-op or a straight pass-through, and
   nothing in app.js needs to ask which it is talking to — it calls
   Native.locate() and Native.share() and gets whichever implementation the
   platform actually has.

   NO BUNDLER. Capacitor's own JavaScript modules are never imported: the
   native shell injects window.Capacitor into the WebView and exposes every
   installed plugin on Capacitor.Plugins, which is all this file uses. The
   npm packages in mobile/package.json exist so `cap sync` knows which native
   pods and Gradle modules to install — their JavaScript is dead weight we
   never load. That is what keeps the app buildable with no build step, and
   keeps the phone running the same files as the website. */

(function (root) {
  'use strict';

  var cap = root.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var plugins = (cap && cap.Plugins) || {};

  function plugin(name) { return isNative ? plugins[name] : null; }

  /* Somewhere to put an error that a user can do nothing about, without
     stopping the app from drawing the weather. */
  function quiet() { return function () {}; }

  var Native = {
    is: isNative,
    platform: (cap && cap.getPlatform && cap.getPlatform()) || 'web',

    /* ------------------------------------------------------------ location */

    /* One promise, whichever engine answers it. Resolves with rounded
       coordinates; rejects with a reason the app can show.

       Rounded to four decimal places — about eleven metres — before anything
       is stored or sent. The forecast for a street corner and the forecast for
       the next street are the same forecast, so the extra precision would be
       nothing but a more exact record of where somebody lives. */
    locate: function () {
      var geo = plugin('Geolocation');
      var options = { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 };

      if (geo) {
        /* Coarse location, asked for by name.

           The plugin can ask for precise location and would by default. This
           app rounds every coordinate to about eleven metres before it does
           anything with it, so precise access would be a permission requested
           and then immediately thrown away — worse for the user and a worse
           answer on both stores' data forms. Android's manifest drops the
           precise permission altogether; here the request names the coarse
           one so neither platform is ever asked for more. */
        return geo.checkPermissions().then(function (status) {
          var granted = status.coarseLocation || status.location;
          if (granted === 'granted') return null;
          if (granted === 'denied') return Promise.reject({ code: 1, message: 'denied' });
          return geo.requestPermissions({ permissions: ['coarseLocation'] }).then(function (after) {
            if ((after.coarseLocation || after.location) !== 'granted') {
              return Promise.reject({ code: 1, message: 'denied' });
            }
            return null;
          });
        }).then(function () {
          return geo.getCurrentPosition(options);
        }).then(round, function (err) {
          return Promise.reject(normalise(err));
        });
      }

      if (!root.navigator || !navigator.geolocation) {
        return Promise.reject({ code: 0, message: 'unsupported' });
      }
      return new Promise(function (resolve, reject) {
        navigator.geolocation.getCurrentPosition(function (pos) { resolve(round(pos)); },
          function (err) { reject(normalise(err)); }, options);
      });
    },

    /* ------------------------------------------------------------- sharing */

    /* True when the OS has a share sheet this app can hand something to. The
       caller uses it to decide whether to offer sharing at all rather than
       raising a button that fails. */
    canShare: function () {
      if (plugin('Share')) return true;
      return !!(root.navigator && navigator.share);
    },

    /* Share the card. Text always; the image too where the platform can carry
       one. Resolves 'shared', 'cancelled', or rejects so the caller can fall
       back to saving the file.

       Neither WebView implements Web Share for files — WKWebView refuses them
       and Android's WebView has no navigator.share at all — so on a phone this
       writes the PNG into the app's own cache directory and hands the share
       sheet a file:// URI. The cache directory is the right home for it: the
       OS clears it when space runs short, and a weather card from last Tuesday
       is not worth keeping. */
    share: function (text, blob, filename) {
      var share = plugin('Share');
      var fs = plugin('Filesystem');

      if (share && fs && blob) {
        return blobToBase64(blob).then(function (data) {
          return fs.writeFile({ path: filename, data: data, directory: 'CACHE' });
        }).then(function (written) {
          return share.share({ text: text, files: [written.uri] });
        }).then(function () { return 'shared'; }, function (err) {
          if (cancelled(err)) return 'cancelled';
          /* A file the share sheet would not take is still worth sending as
             words rather than nothing at all. */
          return share.share({ text: text }).then(function () { return 'shared'; },
            function (e) { return cancelled(e) ? 'cancelled' : Promise.reject(e); });
        });
      }

      if (share) {
        return share.share({ text: text }).then(function () { return 'shared'; },
          function (err) { return cancelled(err) ? 'cancelled' : Promise.reject(err); });
      }

      return Promise.reject({ message: 'no share sheet' });
    },

    /* --------------------------------------------------------- the chrome */

    /* Called once the first screen has something on it. Until then the splash
       covers the WebView, which is the difference between a native app and a
       website that flashes white while it loads.

       launchAutoHide is off in the Capacitor config precisely so this can
       happen when the weather is on screen rather than on a timer. */
    ready: function () {
      var splash = plugin('SplashScreen');
      if (splash) splash.hide({ fadeOutDuration: 220 }).catch(quiet());

      var bar = plugin('StatusBar');
      if (bar) {
        /* The app is dark whatever the phone is set to, so the clock and the
           battery go light. Overlaying puts the app's own background behind
           them; the safe-area padding in styles.css keeps content clear. */
        bar.setStyle({ style: 'DARK' }).catch(quiet());
        if (Native.platform === 'android') {
          bar.setOverlaysWebView({ overlay: true }).catch(quiet());
        }
      }
    },

    /* The web app refreshes on visibilitychange, which a WebView also fires,
       but a phone coming back from the lock screen is worth catching properly:
       it is the moment the number on screen is most likely to be stale. */
    onResume: function (fn) {
      var app = plugin('App');
      if (app && app.addListener) {
        app.addListener('resume', fn);
        return true;
      }
      return false;
    },

    /* Android's hardware back button closes the open sheet, and closes the app
       from the main screen. Without this it does nothing at all, which reads
       as a broken app rather than a considered one. */
    onBack: function (fn) {
      var app = plugin('App');
      if (app && app.addListener) app.addListener('backButton', fn);
    }
  };

  /* --------------------------------------------------------------- helpers */

  function round(pos) {
    var c = pos.coords || pos;
    return {
      lat: Math.round(c.latitude * 10000) / 10000,
      lon: Math.round(c.longitude * 10000) / 10000
    };
  }

  /* The plugin and the browser report a refusal differently. The app only
     needs to know refused from failed, so both are flattened to that. */
  function normalise(err) {
    var message = String((err && err.message) || err || '');
    var denied = (err && err.code === 1) || /denied|permission/i.test(message);
    return { code: denied ? 1 : 2, message: message };
  }

  function cancelled(err) {
    var message = String((err && err.message) || err || '');
    return /cancel|abort|dismiss/i.test(message);
  }

  /* The Filesystem plugin wants base64 without the data: prefix. */
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(reader.error); };
      reader.onload = function () {
        var out = String(reader.result);
        var comma = out.indexOf(',');
        resolve(comma < 0 ? out : out.slice(comma + 1));
      };
      reader.readAsDataURL(blob);
    });
  }

  root.Native = Native;

})(typeof self !== 'undefined' ? self : this);
