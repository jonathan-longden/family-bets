/* The mouth.

   Everything funny in the app comes out of this file, and every line in it is
   attached to something the forecast actually said. That is the whole
   discipline: the app is allowed to have an opinion about the weather, and not
   allowed to invent the weather it is having an opinion about. A grey
   afternoon is never told the sun is out.

   How it works. `situation()` turns a forecast into a short list of true
   things, most notable first. The first one that has a bank of lines wins, and
   a line is picked from that bank by a hash of the day, the hour and the
   situation — so the same conditions do not produce the same sentence for the
   rest of your life, but the headline also does not reshuffle itself every
   time the screen redraws.

   Every line is a pair: [what it says, what it says in front of your mother].
   The clean twin is written to be funny in its own right rather than the
   sweary one with the word cut out, and a test asserts both halves exist and
   that the clean half is actually clean. Not every sweary line swears —
   swearing in every sentence stops being funny by about the third one. */

(function (root) {
  'use strict';

  var V = {};
  var W = root.Weather;

  /* ------------------------------------------------------------ the banks */

  var LINES = {

    /* --- the good stuff ------------------------------------------------ */
    glorious: [
      ['LOOK AT THAT. ABSOLUTELY FUCKING LOVELY.', 'LOOK AT THAT. ABSOLUTELY LOVELY.'],
      ['YOU BEAUTIFUL BASTARD, LOOK AT THAT SKY.', 'WOULD YOU LOOK AT THAT SKY.'],
      ['NOT BAD, WEATHER. NOT BAD AT ALL.', 'NOT BAD, WEATHER. NOT BAD AT ALL.'],
      ['TODAY HAS MAIN-CHARACTER ENERGY.', 'TODAY HAS MAIN-CHARACTER ENERGY.'],
      ['THE SUN IS SHOWING OFF AND WE LOVE IT.', 'THE SUN IS SHOWING OFF AND WE LOVE IT.']
    ],
    'morning.glorious': [
      ['GOOD MORNING, YOU RAY OF FUCKING SUNSHINE.', 'GOOD MORNING, YOU RAY OF SUNSHINE.'],
      ['MORNING. THE SKY HAS PULLED IT OUT THE BAG.', 'MORNING. THE SKY HAS PULLED IT OUT THE BAG.'],
      ['UP YOU GET. IT IS GORGEOUS OUT THERE.', 'UP YOU GET. IT IS GORGEOUS OUT THERE.']
    ],
    'evening.glorious': [
      ['WHAT AN EVENING. GET OUT THERE AND LOOK AT IT.', 'WHAT AN EVENING. WORTH A LOOK OUT THE WINDOW.'],
      ['GOLDEN HOUR IS ABOUT TO SHOW OFF.', 'GOLDEN HOUR IS ABOUT TO SHOW OFF.']
    ],

    /* --- clear but cold ------------------------------------------------ */
    crisp: [
      ['CLEAR, COLD, AND WEIRDLY BRILLIANT.', 'CLEAR, COLD, AND WEIRDLY BRILLIANT.'],
      ['BLOODY COLD. BLOODY BEAUTIFUL.', 'PROPERLY COLD. PROPERLY BEAUTIFUL.'],
      ['BLUE SKY, NIPPY AIR. GOOD COMBINATION.', 'BLUE SKY, NIPPY AIR. GOOD COMBINATION.']
    ],
    'morning.crisp': [
      ['MORNING. CRISP, CLEAR, AND A BIT SHARP.', 'MORNING. CRISP, CLEAR, AND A BIT SHARP.'],
      ['COLD START, GORGEOUS SKY. FAIR TRADE.', 'COLD START, GORGEOUS SKY. FAIR TRADE.']
    ],

    /* --- rain ----------------------------------------------------------- */
    rain: [
      ['WELL. THAT IS FUCKING WET.', 'WELL. THAT IS EXTREMELY WET.'],
      ['THE SKY IS HAVING A MOAN AGAIN.', 'THE SKY IS HAVING A MOAN AGAIN.'],
      ['RAIN. OF COURSE IT IS RAINING.', 'RAIN. OF COURSE IT IS RAINING.'],
      ['WET. RELENTLESSLY, BRITISHLY WET.', 'WET. RELENTLESSLY, BRITISHLY WET.']
    ],
    'morning.rain': [
      ['MORNING. THE SKY IS HAVING A FUCKING MOAN.', 'MORNING. THE SKY IS HAVING A PROPER MOAN.'],
      ['MORNING. IT IS CHUCKING IT DOWN.', 'MORNING. IT IS CHUCKING IT DOWN.'],
      ['GOOD MORNING. BRING THE BIG COAT.', 'GOOD MORNING. BRING THE BIG COAT.']
    ],
    downpour: [
      ['FUCKING HELL, THAT IS A LOT OF RAIN.', 'GOOD GRIEF, THAT IS A LOT OF RAIN.'],
      ['IT IS ABSOLUTELY HAMMERING IT DOWN.', 'IT IS ABSOLUTELY HAMMERING IT DOWN.'],
      ['BIBLICAL. GENUINELY BIBLICAL.', 'BIBLICAL. GENUINELY BIBLICAL.']
    ],
    showers: [
      ['SHOWERS. ON, OFF, ON AGAIN. TYPICAL.', 'SHOWERS. ON, OFF, ON AGAIN. TYPICAL.'],
      ['MAKE YOUR FUCKING MIND UP, SKY.', 'MAKE YOUR MIND UP, SKY.'],
      ['IN AND OUT ALL DAY. TAKE THE BROLLY.', 'IN AND OUT ALL DAY. TAKE THE BROLLY.']
    ],
    drizzle: [
      ['NOT QUITE RAIN. STILL ANNOYING.', 'NOT QUITE RAIN. STILL ANNOYING.'],
      ['THAT FINE DRIZZLE THAT SOAKS YOU THROUGH.', 'THAT FINE DRIZZLE THAT SOAKS YOU THROUGH.'],
      ['THE SKY IS SPITTING AT YOU. RUDE.', 'THE SKY IS SPITTING AT YOU. RUDE.']
    ],

    /* --- the dramatic stuff --------------------------------------------- */
    thunder: [
      ['THE SKY IS ABSOLUTELY KICKING OFF.', 'THE SKY IS ABSOLUTELY KICKING OFF.'],
      ['THUNDER. STAY IN, PUT THE KETTLE ON.', 'THUNDER. STAY IN, PUT THE KETTLE ON.'],
      ['SOMEONE UPSTAIRS IS IN A FUCKING MOOD.', 'SOMEONE UPSTAIRS IS IN A PROPER MOOD.']
    ],
    snow: [
      ['SNOW. ACTUAL, GENUINE SNOW.', 'SNOW. ACTUAL, GENUINE SNOW.'],
      ['IT IS SNOWING AND NOTHING ELSE MATTERS.', 'IT IS SNOWING AND NOTHING ELSE MATTERS.'],
      ['THE COUNTRY IS ABOUT TO LOSE ITS MIND.', 'THE COUNTRY IS ABOUT TO LOSE ITS MIND.']
    ],
    ice: [
      ['ICE OUT THERE. MIND HOW YOU GO.', 'ICE OUT THERE. MIND HOW YOU GO.'],
      ['FREEZING RAIN. THE WORST ONE.', 'FREEZING RAIN. THE WORST ONE.']
    ],
    fog: [
      ['CAN NOT SEE A BLOODY THING.', 'CAN NOT SEE A THING.'],
      ['FOG. VERY ATMOSPHERIC. VERY INCONVENIENT.', 'FOG. VERY ATMOSPHERIC. VERY INCONVENIENT.'],
      ['THE WORLD HAS BEEN TURNED DOWN TO 20 METRES.', 'THE WORLD HAS BEEN TURNED DOWN TO 20 METRES.']
    ],
    gale: [
      ['BLOODY HELL, IT IS WINDY.', 'GOODNESS ME, IT IS WINDY.'],
      ['HOLD ONTO YOUR HAIR.', 'HOLD ONTO YOUR HAIR.'],
      ['THE BINS ARE GOING ON A JOURNEY.', 'THE BINS ARE GOING ON A JOURNEY.']
    ],
    windy: [
      ['BREEZY. HAIR HAS NO CHANCE.', 'BREEZY. HAIR HAS NO CHANCE.'],
      ['A BIT BLOWY OUT THERE.', 'A BIT BLOWY OUT THERE.']
    ],

    /* --- the extremes ---------------------------------------------------- */
    scorching: [
      ['THE SUN HAS LOST THE FUCKING PLOT.', 'THE SUN HAS COMPLETELY LOST THE PLOT.'],
      ['IT IS TOO HOT. THAT IS THE FORECAST.', 'IT IS TOO HOT. THAT IS THE FORECAST.'],
      ['FIND SHADE. FIND A FAN. FIND A FRIDGE.', 'FIND SHADE. FIND A FAN. FIND A FRIDGE.']
    ],
    hot: [
      ['PROPER WARM. GO STAND IN IT.', 'PROPER WARM. GO STAND IN IT.'],
      ['THE SUN IS SHOWING OFF AGAIN.', 'THE SUN IS SHOWING OFF AGAIN.'],
      ['SHORTS WEATHER, AND NO ARGUMENTS.', 'SHORTS WEATHER, AND NO ARGUMENTS.']
    ],
    freezing: [
      ['MORNING. IT IS FUCKING FREEZING.', 'MORNING. IT IS ABSOLUTELY FREEZING.'],
      ['BELOW ZERO. WEAR EVERYTHING YOU OWN.', 'BELOW ZERO. WEAR EVERYTHING YOU OWN.'],
      ['YOUR JUMPER IS GETTING PROMOTED TO FULL-TIME.', 'YOUR JUMPER IS GETTING PROMOTED TO FULL-TIME.']
    ],
    cold: [
      ['COLD. BRING A COAT AND A GRUDGE.', 'COLD. BRING A COAT AND A GRUDGE.'],
      ['NIPPY OUT. NOTHING A COAT CANNOT FIX.', 'NIPPY OUT. NOTHING A COAT CANNOT FIX.'],
      ['IT IS A BIT BLOODY BRISK.', 'IT IS A BIT BRISK.']
    ],
    muggy: [
      ['CLOSE, STICKY, AND A BIT MUCH.', 'CLOSE, STICKY, AND A BIT MUCH.'],
      ['THE AIR IS ABOUT 90% SOUP.', 'THE AIR IS ABOUT 90% SOUP.']
    ],

    /* --- the everyday --------------------------------------------------- */
    grey: [
      ['GREY. MOODY. VERY FUCKING BRITISH.', 'GREY. MOODY. VERY BRITISH INDEED.'],
      ['GREY. ABSOLUTELY COMMITTED TO GREY.', 'GREY. ABSOLUTELY COMMITTED TO GREY.'],
      ['THE SKY HAS GONE FOR BEIGE TODAY.', 'THE SKY HAS GONE FOR BEIGE TODAY.'],
      ['COULD BE WORSE. NOT MUCH, BUT IT COULD.', 'COULD BE WORSE. NOT MUCH, BUT IT COULD.']
    ],
    'morning.grey': [
      ['MORNING. THE SKY HAS NOT WOKEN UP EITHER.', 'MORNING. THE SKY HAS NOT WOKEN UP EITHER.'],
      ['GREY START. THE NATION IS USED TO IT.', 'GREY START. THE NATION IS USED TO IT.']
    ],
    cloud: [
      ['THE CLOUDS ARE HAVING A DAY OFF.', 'THE CLOUDS ARE HAVING A DAY OFF.'],
      ['BIT OF CLOUD, BIT OF SUN. FINE.', 'BIT OF CLOUD, BIT OF SUN. FINE.'],
      ['NOT BAD. GENUINELY, NOT BAD.', 'NOT BAD. GENUINELY, NOT BAD.']
    ],
    changeable: [
      ['FOUR FUCKING SEASONS BEFORE LUNCH.', 'FOUR SEASONS BEFORE LUNCH.'],
      ['THE SKY CANNOT DECIDE WHAT IT IS DOING.', 'THE SKY CANNOT DECIDE WHAT IT IS DOING.'],
      ['BRING A COAT AND SUNGLASSES. BOTH.', 'BRING A COAT AND SUNGLASSES. BOTH.']
    ],
    mild: [
      ['MILD. UNREMARKABLE. QUIETLY FINE.', 'MILD. UNREMARKABLE. QUIETLY FINE.'],
      ['NOTHING TO REPORT. HONESTLY, LOVELY.', 'NOTHING TO REPORT. HONESTLY, LOVELY.'],
      ['PERFECTLY DECENT OUT. TAKE THE WIN.', 'PERFECTLY DECENT OUT. TAKE THE WIN.']
    ],

    /* --- after dark ------------------------------------------------------ */
    'night.clear': [
      ['CLEAR NIGHT. GO AND LOOK UP.', 'CLEAR NIGHT. GO AND LOOK UP.'],
      ['NOT A CLOUD. THE STARS ARE OUT.', 'NOT A CLOUD. THE STARS ARE OUT.']
    ],
    'night.rain': [
      ['RAINING IN THE DARK. THE FULL BRITISH.', 'RAINING IN THE DARK. THE FULL BRITISH.'],
      ['LOVELY NIGHT FOR STAYING IN.', 'LOVELY NIGHT FOR STAYING IN.']
    ],
    night: [
      ['DARK OUT. SHOCKING, I KNOW.', 'DARK OUT. SHOCKING, I KNOW.'],
      ['THE SKY HAS CLOCKED OFF FOR THE DAY.', 'THE SKY HAS CLOCKED OFF FOR THE DAY.']
    ]
  };

  /* --------------------------------------------------------- the daily lines */

  /* Shorter, because fifteen of them are on screen at once. Keyed on the same
     families, so a day never says something its own numbers contradict. */
  var DAY_LINES = {
    glorious: [
      ['THE SUN IS SHOWING OFF.', 'THE SUN IS SHOWING OFF.'],
      ['ABSOLUTELY BLOODY LOVELY.', 'ABSOLUTELY LOVELY.'],
      ['A PROPER GOOD ONE.', 'A PROPER GOOD ONE.']
    ],
    crisp: [
      ['COLD AND BRIGHT. LOVELY.', 'COLD AND BRIGHT. LOVELY.'],
      ['SHARP AIR, BLUE SKY.', 'SHARP AIR, BLUE SKY.']
    ],
    rain: [
      ['WELL, THAT IS WET.', 'WELL, THAT IS WET.'],
      ['A WET ONE. SORRY.', 'A WET ONE. SORRY.'],
      ['THE SKY IS MOANING.', 'THE SKY IS MOANING.']
    ],
    downpour: [
      ['BRING THE ARK.', 'BRING THE ARK.'],
      ['UTTERLY SOAKING.', 'UTTERLY SOAKING.']
    ],
    showers: [
      ['MAKE YOUR MIND UP, SKY.', 'MAKE YOUR MIND UP, SKY.'],
      ['ON, OFF, ON AGAIN.', 'ON, OFF, ON AGAIN.']
    ],
    drizzle: [
      ['DAMP. JUST DAMP.', 'DAMP. JUST DAMP.'],
      ['THAT SOAKY DRIZZLE.', 'THAT SOAKY DRIZZLE.']
    ],
    thunder: [
      ['THE SKY KICKS OFF.', 'THE SKY KICKS OFF.'],
      ['BANGS AND FLASHES.', 'BANGS AND FLASHES.']
    ],
    snow: [
      ['SNOW. TOTAL CHAOS.', 'SNOW. TOTAL CHAOS.'],
      ['THE WHITE STUFF.', 'THE WHITE STUFF.']
    ],
    ice: [
      ['ICY. GO CAREFULLY.', 'ICY. GO CAREFULLY.']
    ],
    fog: [
      ['MURK. TOTAL MURK.', 'MURK. TOTAL MURK.']
    ],
    gale: [
      ['HOLD ONTO YOUR HAIR.', 'HOLD ONTO YOUR HAIR.'],
      ['THE FENCE IS IN DANGER.', 'THE FENCE IS IN DANGER.']
    ],
    scorching: [
      ['THE SUN HAS GONE MAD.', 'THE SUN HAS GONE MAD.'],
      ['MELTING. ABSOLUTELY.', 'MELTING. ABSOLUTELY.']
    ],
    hot: [
      ['A PROPER WARM ONE.', 'A PROPER WARM ONE.'],
      ['SHORTS. NO ARGUMENTS.', 'SHORTS. NO ARGUMENTS.']
    ],
    freezing: [
      ['JUMPER WEATHER. FULL TIME.', 'JUMPER WEATHER. FULL TIME.'],
      ['BLOODY FREEZING.', 'ABSOLUTELY FREEZING.']
    ],
    cold: [
      ['COAT WEATHER.', 'COAT WEATHER.'],
      ['A BIT BRISK.', 'A BIT BRISK.']
    ],
    grey: [
      ['COMMITTED TO GREY.', 'COMMITTED TO GREY.'],
      ['THE BEIGE DAY.', 'THE BEIGE DAY.'],
      ['CLOUD. LOTS OF IT.', 'CLOUD. LOTS OF IT.']
    ],
    cloud: [
      ['A BIT OF EVERYTHING.', 'A BIT OF EVERYTHING.'],
      ['FINE. GENUINELY FINE.', 'FINE. GENUINELY FINE.']
    ],
    mild: [
      ['NOTHING TO REPORT.', 'NOTHING TO REPORT.'],
      ['QUIETLY DECENT.', 'QUIETLY DECENT.']
    ]
  };

  /* ------------------------------------------------------- the little moments */

  /* Each of these only exists when the forecast supports it. They are the
     difference between a weather app and one that seems to be paying
     attention. */
  var MOMENTS = {
    betterTomorrow: [
      ['TOMORROW LOOKS FUCKING PROMISING.', 'TOMORROW LOOKS SERIOUSLY PROMISING.'],
      ['HANG ON FOR TOMORROW. IT IS A GOOD ONE.', 'HANG ON FOR TOMORROW. IT IS A GOOD ONE.']
    ],
    worseTomorrow: [
      ['ENJOY TODAY. TOMORROW LOOKS LIKE A RIGHT BASTARD.', 'ENJOY TODAY. TOMORROW LOOKS LIKE A RIGHT STINKER.'],
      ['MAKE THE MOST OF THIS. TOMORROW TURNS.', 'MAKE THE MOST OF THIS. TOMORROW TURNS.']
    ],
    heatwave: [
      ['YOUR FAN IS ABOUT TO BECOME YOUR BEST FRIEND.', 'YOUR FAN IS ABOUT TO BECOME YOUR BEST FRIEND.'],
      ['IT IS GETTING SERIOUSLY HOT THIS WEEK.', 'IT IS GETTING SERIOUSLY HOT THIS WEEK.']
    ],
    coldSnap: [
      ['DIG THE BIG COAT OUT. IT IS TURNING.', 'DIG THE BIG COAT OUT. IT IS TURNING.'],
      ['SCRAPER ON THE WINDSCREEN WEATHER INCOMING.', 'SCRAPER ON THE WINDSCREEN WEATHER INCOMING.']
    ],
    rainEnding: [
      ['THE RAIN IS FUCKING OFF AROUND {time}.', 'THE RAIN CLEARS OFF AROUND {time}.'],
      ['DRY FROM ABOUT {time}. HOLD ON.', 'DRY FROM ABOUT {time}. HOLD ON.']
    ],
    rainComing: [
      ['RAIN ARRIVES AROUND {time}. YOU HAVE BEEN WARNED.', 'RAIN ARRIVES AROUND {time}. YOU HAVE BEEN WARNED.'],
      ['IT TURNS WET ABOUT {time}.', 'IT TURNS WET ABOUT {time}.']
    ],
    goodSunset: [
      ['LOOK UP AT {time}. THE SKY IS SHOWING OFF.', 'LOOK UP AT {time}. THE SKY IS SHOWING OFF.'],
      ['CLEAR SKY AT SUNSET. {time}. DO NOT MISS IT.', 'CLEAR SKY AT SUNSET. {time}. DO NOT MISS IT.']
    ],
    weekend: [
      ['THE WEEKEND IS LOOKING ALRIGHT, ACTUALLY.', 'THE WEEKEND IS LOOKING ALRIGHT, ACTUALLY.'],
      ['GOOD NEWS: THE WEEKEND BEHAVES ITSELF.', 'GOOD NEWS: THE WEEKEND BEHAVES ITSELF.']
    ],
    weekendWashout: [
      ['THE WEEKEND IS GOING TO BE A WET ONE.', 'THE WEEKEND IS GOING TO BE A WET ONE.'],
      ['BAD NEWS FOR THE WEEKEND. BRING IT INDOORS.', 'BAD NEWS FOR THE WEEKEND. BRING IT INDOORS.']
    ],
    sunAfterRain: [
      ["LOOK WHO'S TURNED UP. SUN FROM ABOUT {time}.", "LOOK WHO'S TURNED UP. SUN FROM ABOUT {time}."],
      ['RAIN OFF, SUN ON. AROUND {time}.', 'RAIN OFF, SUN ON. AROUND {time}.']
    ],
    firstSunAfterGrey: [
      ['FINALLY. FUCKING FINALLY. THE SUN IS BACK.', 'FINALLY. HONESTLY, FINALLY. THE SUN IS BACK.'],
      ['FIRST PROPER SUNSHINE IN DAYS.', 'FIRST PROPER SUNSHINE IN DAYS.']
    ],
    firstRainAfterDry: [
      ["WELL, THAT DIDN'T LAST. RAIN IS BACK.", "WELL, THAT DIDN'T LAST. RAIN IS BACK."],
      ['THE DRY SPELL IS OVER. IT WAS NICE.', 'THE DRY SPELL IS OVER. IT WAS NICE.']
    ],
    bigJump: [
      ['BLOODY HELL, THAT GOT WARM — UP {by}° ON YESTERDAY.', 'GOODNESS, THAT GOT WARM — UP {by}° ON YESTERDAY.'],
      ['{by}° WARMER THAN YESTERDAY. ENJOY.', '{by}° WARMER THAN YESTERDAY. ENJOY.']
    ],
    bigDrop: [
      ['WHO TURNED THE HEATING OFF? DOWN {by}° ON YESTERDAY.', 'WHO TURNED THE HEATING OFF? DOWN {by}° ON YESTERDAY.'],
      ['{by}° COLDER THAN YESTERDAY. COAT.', '{by}° COLDER THAN YESTERDAY. COAT.']
    ],
    veryWindy: [
      ['THE ATMOSPHERE IS HAVING A FUCKING TANTRUM.', 'THE ATMOSPHERE IS HAVING AN ABSOLUTE TANTRUM.'],
      ['HOLD ONTO SOMETHING. GUSTS TO {gust}.', 'HOLD ONTO SOMETHING. GUSTS TO {gust}.']
    ],
    thunderComing: [
      ['THE SKY IS THROWING FURNITURE AROUND. STORMS AT {time}.', 'THE SKY IS THROWING FURNITURE AROUND. STORMS AT {time}.'],
      ['THUNDER DUE ABOUT {time}.', 'THUNDER DUE ABOUT {time}.']
    ],
    snowComing: [
      ["THE SKY'S SENT US CONFETTI. SNOW FROM {time}.", "THE SKY'S SENT US CONFETTI. SNOW FROM {time}."],
      ['SNOW ON THE WAY, AROUND {time}.', 'SNOW ON THE WAY, AROUND {time}.']
    ],
    goodSunrise: [
      ["THE DAY'S MADE A FUCKING EFFORT. SUNRISE {time}.", "THE DAY'S MADE A PROPER EFFORT. SUNRISE {time}."],
      ['CLEAR SKY AT SUNRISE, {time}. WORTH GETTING UP FOR.', 'CLEAR SKY AT SUNRISE, {time}. WORTH GETTING UP FOR.']
    ]
  };

  var ERRORS = [
    ['FUCK. THE WEATHER MACHINE HAS GONE QUIET.', 'WELL. THE WEATHER MACHINE HAS GONE QUIET.'],
    ['NO WEATHER. THE INTERNET IS SULKING.', 'NO WEATHER. THE INTERNET IS SULKING.']
  ];

  var NO_PLACE = [
    ['WHERE THE BLOODY HELL ARE YOU?', 'WHERE ARE YOU, THEN?'],
    ['GIVE ME A PLACE AND I WILL GIVE YOU THE WEATHER.', 'GIVE ME A PLACE AND I WILL GIVE YOU THE WEATHER.']
  ];

  /* ------------------------------------------------------------- the picking */

  /* Deterministic, from a seed the caller controls. Same seed, same line —
     which is what stops the headline reshuffling itself every time the screen
     redraws — and the seed carries the day and the hour, which is what stops
     the same conditions saying the same thing forever. */
  function hash(text) {
    var n = 0;
    for (var i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) >>> 0;
    return n;
  }

  function choose(bank, seed, sweary) {
    if (!bank || !bank.length) return '';
    var pair = bank[hash(String(seed)) % bank.length];
    return sweary === false ? pair[1] : pair[0];
  }

  function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] !== undefined ? String(vars[k]) : m;
    });
  }

  /* ---------------------------------------------------------- the situation */

  V.slot = function (hour) {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  };

  /* The true things about right now, most notable first. Order is the whole
     argument: thunder beats temperature, a downpour beats a grey sky, and
     "quite nice actually" only wins when nothing louder is happening. */
  V.situation = function (forecast, now) {
    var n = W.now(forecast, now);
    var fam = W.family(n.code);
    var hour = W.hourOf(now, forecast.offset);
    var slot = V.slot(hour);
    var out = [];

    if (fam === 'thunder') out.push('thunder');
    if (fam === 'snow') out.push('snow');
    if (fam === 'ice') out.push('ice');
    if (fam === 'downpour') out.push('downpour');
    if (fam === 'fog') out.push('fog');
    if (n.gust >= 60) out.push('gale');
    if (fam === 'rain') out.push('rain');
    if (fam === 'showers') out.push('showers');
    if (fam === 'drizzle') out.push('drizzle');
    if (n.feels >= 30) out.push('scorching');
    if (n.feels <= -1) out.push('freezing');
    if (n.gust >= 45) out.push('gale');
    if (n.gust >= 32) out.push('windy');

    /* Night gets its own voice, but only once the loud weather has had its
       say — thunder at midnight is still thunder. */
    if (!n.day) {
      if (fam === 'clear') out.push('night.clear');
      if (fam === 'rain' || fam === 'showers' || fam === 'drizzle') out.push('night.rain');
      out.push('night');
    }

    if (fam === 'clear') {
      if (n.feels >= 26) out.push('hot');
      else if (n.feels >= 15) out.push('glorious');
      else if (n.feels <= 7) out.push('crisp');
      else out.push('glorious');
    }
    if (n.feels >= 27) out.push('hot');
    if (n.feels >= 22 && n.humidity >= 75) out.push('muggy');
    if (n.feels <= 4) out.push('cold');

    /* A day that cannot make its mind up: both rain and clear spells in the
       daylight hours ahead. */
    if (V.changeable(forecast, now)) out.push('changeable');

    if (fam === 'grey') out.push('grey');
    if (fam === 'cloud') out.push('cloud');
    out.push('mild');

    return { list: out, slot: slot, now: n };
  };

  V.changeable = function (forecast, now) {
    var hours = W.hoursFrom(forecast, now, 12);
    var wet = 0, bright = 0;
    for (var i = 0; i < hours.length; i++) {
      var fam = W.family(hours[i].code);
      if (fam === 'rain' || fam === 'showers' || fam === 'downpour' || fam === 'drizzle') wet++;
      if (fam === 'clear' && hours[i].day) bright++;
    }
    return wet >= 2 && bright >= 2;
  };

  /* -------------------------------------------------------------- headline */

  V.headline = function (forecast, settings, now) {
    var s = V.situation(forecast, now);
    var day = W.dayOf(now, forecast.offset);
    var hour = W.hourOf(now, forecast.offset);

    for (var i = 0; i < s.list.length; i++) {
      var kind = s.list[i];
      var bank = LINES[s.slot + '.' + kind] || LINES[kind];
      if (!bank) continue;
      return {
        kind: kind,
        slot: s.slot,
        text: choose(bank, day + ':' + hour + ':' + kind, settings.sweary)
      };
    }
    return { kind: 'mild', slot: s.slot, text: choose(LINES.mild, day + ':' + hour, settings.sweary) };
  };

  /* The honest sentence under the joke. No opinions, just what it is doing. */
  V.subline = function (forecast, settings, now) {
    var n = W.now(forecast, now);
    var bits = [W.skyName(n.code)];
    if (Math.round(n.feels) !== Math.round(n.temp)) {
      bits.push('feels like ' + W.temp(n.feels, settings.units));
    }
    if (n.prob >= 20) bits.push(n.prob + '% chance of rain');
    return bits.join(' · ');
  };

  /* ------------------------------------------------------------- day lines */

  V.dayKind = function (day) {
    var fam = W.family(day.code);
    if (fam === 'thunder') return 'thunder';
    if (fam === 'snow') return 'snow';
    if (fam === 'ice') return 'ice';
    if (fam === 'downpour') return 'downpour';
    if (fam === 'fog') return 'fog';
    if (fam === 'rain') return 'rain';
    if (fam === 'showers') return 'showers';
    if (fam === 'drizzle') return 'drizzle';
    if (day.gust !== null && day.gust >= 60) return 'gale';
    if (day.max !== null && day.max >= 30) return 'scorching';
    if (day.max !== null && day.max >= 24) return 'hot';
    if (day.min !== null && day.min <= -2) return 'freezing';
    if (fam === 'clear') return (day.max !== null && day.max >= 16) ? 'glorious' : 'crisp';
    if (day.max !== null && day.max <= 6) return 'cold';
    if (fam === 'grey') return 'grey';
    if (fam === 'cloud') return 'cloud';
    return 'mild';
  };

  V.dayLine = function (day, settings) {
    var kind = V.dayKind(day);
    var bank = DAY_LINES[kind] || DAY_LINES.mild;
    return choose(bank, day.t + ':' + kind, settings.sweary);
  };

  /* ------------------------------------------------------------ the moments */

  /* Small, true, and only when they are worth saying. Everything here is
     derived from the forecast rather than from a calendar of "engagement". */
  V.moments = function (forecast, settings, now) {
    var out = [];
    var offset = forecast.offset;
    var todayIndex = W.todayIndex(forecast, now);
    var today = forecast.days[todayIndex];
    var yesterday = forecast.days[todayIndex - 1];
    var tomorrow = forecast.days[todayIndex + 1];
    var seedDay = W.dayOf(now, offset);
    var seen = {};

    function add(key, icon, vars) {
      var bank = MOMENTS[key];
      if (!bank || seen[key]) return;
      seen[key] = true;
      out.push({ key: key, icon: icon, text: fill(choose(bank, seedDay + ':' + key, settings.sweary), vars) });
    }

    var hours = W.hoursFrom(forecast, now, 16);
    var recent = W.recent(forecast, now);

    /* The loud stuff first: things that change what you do in the next few
       hours, and only where the forecast actually contains them. */
    var thunder = hours.filter(function (h) { return W.family(h.code) === 'thunder'; })[0];
    if (thunder) add('thunderComing', '⛈️', { time: W.clock(thunder.t, offset, settings.ampm) });

    var snow = hours.filter(function (h) { return W.family(h.code) === 'snow'; })[0];
    if (snow) add('snowComing', '❄️', { time: W.clock(snow.t, offset, settings.ampm) });

    var gust = hours.reduce(function (a, h) { return Math.max(a, h.gust); }, 0);
    if (gust >= 65) add('veryWindy', '💨', { gust: W.speed(gust, settings.units) });

    /* Rain starting, stopping, or giving way to actual sunshine. */
    var wetNow = hours.length && isWet(hours[0]);
    if (wetNow) {
      for (var i = 1; i < hours.length; i++) {
        if (!isWet(hours[i]) && !isWet(hours[Math.min(i + 1, hours.length - 1)])) {
          if (W.isBright(hours[i])) add('sunAfterRain', '🌤️', { time: W.clock(hours[i].t, offset, settings.ampm) });
          else add('rainEnding', '🌤️', { time: W.clock(hours[i].t, offset, settings.ampm) });
          break;
        }
      }
    } else {
      for (var j = 1; j < hours.length; j++) {
        if (isWet(hours[j])) {
          add('rainComing', '☔', { time: W.clock(hours[j].t, offset, settings.ampm) });
          break;
        }
      }
    }

    /* Breaking a run: only sayable because the request asks for past days. */
    if (recent.greyRun >= 2 && today && W.family(today.code) === 'clear') add('firstSunAfterGrey', '☀️');
    if (recent.dryRun >= 3 && today && today.prob !== null && today.prob >= 60) add('firstRainAfterDry', '🌧️');

    /* Yesterday against today, which is how people actually feel temperature. */
    if (yesterday && today && yesterday.max !== null && today.max !== null) {
      var jump = today.max - yesterday.max;
      if (jump >= 6) add('bigJump', '🌡️', { by: Math.round(jump) });
      else if (jump <= -6) add('bigDrop', '🥶', { by: Math.round(-jump) });
    }

    /* Tomorrow, when tomorrow is a different animal. */
    if (today && tomorrow && today.max !== null && tomorrow.max !== null) {
      var warmer = tomorrow.max - today.max;
      var dryer = (today.prob || 0) - (tomorrow.prob || 0);
      if (warmer >= 4 || (dryer >= 40 && warmer >= 0)) add('betterTomorrow', '🌞');
      else if (warmer <= -5 || (dryer <= -40 && warmer <= 0)) add('worseTomorrow', '🌧️');
    }

    /* A spell of something extreme in the week ahead. */
    var hotDays = 0, coldDays = 0;
    for (var k = todayIndex; k < Math.min(forecast.days.length, todayIndex + 6); k++) {
      var d = forecast.days[k];
      if (d.max !== null && d.max >= 28) hotDays++;
      if (d.min !== null && d.min <= -2) coldDays++;
    }
    if (hotDays >= 2) add('heatwave', '🥵');
    else if (coldDays >= 2) add('coldSnap', '🥶');

    /* The sky putting on a show, at either end of the day. */
    if (today && today.sunset > now && today.sunset - now < 5 * 3600) {
      var atSunset = nearestHour(forecast, today.sunset);
      if (atSunset && W.family(atSunset.code) === 'clear') {
        add('goodSunset', '🌇', { time: W.clock(today.sunset, offset, settings.ampm) });
      }
    }
    var nextSunrise = null;
    for (var r = todayIndex; r < forecast.days.length; r++) {
      if (forecast.days[r].sunrise > now) { nextSunrise = forecast.days[r].sunrise; break; }
    }
    if (nextSunrise && nextSunrise - now < 4 * 3600) {
      var atSunrise = nearestHour(forecast, nextSunrise);
      if (atSunrise && W.family(atSunrise.code) === 'clear') {
        add('goodSunrise', '🌅', { time: W.clock(nextSunrise, offset, settings.ampm) });
      }
    }

    /* And the weekend, if it is far enough away to be news. */
    var weekend = weekendDays(forecast, todayIndex, offset);
    if (weekend.length === 2 && !W.isWeekend(now, offset)) {
      var wet = weekend.filter(function (d) { return (d.prob || 0) >= 60; }).length;
      var fine = weekend.filter(function (d) {
        return (d.prob === null || d.prob < 35) && W.family(d.code) !== 'rain';
      }).length;
      if (wet === 2) add('weekendWashout', '☔');
      else if (fine === 2) add('weekend', '🎉');
    }

    return out.slice(0, 3);
  };

  function isWet(h) {
    var fam = W.family(h.code);
    return h.mm >= 0.2 || fam === 'rain' || fam === 'downpour' || fam === 'showers' || fam === 'drizzle';
  }

  function nearestHour(forecast, t) {
    var best = null, gap = Infinity;
    for (var i = 0; i < forecast.hours.length; i++) {
      var d = Math.abs(forecast.hours[i].t - t);
      if (d < gap) { gap = d; best = forecast.hours[i]; }
    }
    return gap <= 3600 ? best : null;
  }

  function weekendDays(forecast, from, offset) {
    var out = [];
    for (var i = from; i < forecast.days.length && out.length < 2; i++) {
      if (W.isWeekend(forecast.days[i].t, offset)) out.push(forecast.days[i]);
      else if (out.length) break;
    }
    return out;
  }

  /* --------------------------------------------------------------- the rest */

  V.error = function (settings, seed) { return choose(ERRORS, seed || 0, settings.sweary); };
  V.noPlace = function (settings) { return choose(NO_PLACE, 1, settings.sweary); };

  /* Exposed so the tests can walk every line in the app and check that the
     clean half is genuinely clean and genuinely different work. */
  V.banks = { LINES: LINES, DAY_LINES: DAY_LINES, MOMENTS: MOMENTS, ERRORS: ERRORS, NO_PLACE: NO_PLACE };

  /* ------------------------------------------------------------- sky mood */

  /* The sky, as a person. Derived from the same numbers as everything else —
     a grey day is never "delighted". */
  var MOODS = {
    delighted: [
      ['Absolutely fucking delighted.', 'Absolutely delighted with itself.'],
      ['In a spectacularly good mood.', 'In a spectacularly good mood.']
    ],
    showingOff: [
      ['Showing off. Shamelessly.', 'Showing off. Shamelessly.'],
      ['Peacocking, frankly.', 'Peacocking, frankly.']
    ],
    wellBehaved: [
      ['Surprisingly well behaved.', 'Surprisingly well behaved.'],
      ['Quietly getting on with it.', 'Quietly getting on with it.']
    ],
    unavailable: [
      ['Grey and emotionally unavailable.', 'Grey and emotionally unavailable.'],
      ['Present, but not really here.', 'Present, but not really here.']
    ],
    annoyed: [
      ['Mildly pissed off.', 'Mildly put out.'],
      ['In a bit of a strop.', 'In a bit of a strop.']
    ],
    undecided: [
      ["Can't make its bloody mind up.", "Can't make its mind up."],
      ['Wildly indecisive.', 'Wildly indecisive.']
    ],
    tantrum: [
      ['Having a proper tantrum.', 'Having a proper tantrum.'],
      ['Absolutely losing it.', 'Absolutely losing it.']
    ],
    sulking: [
      ['Sulking, and taking it out on us.', 'Sulking, and taking it out on us.'],
      ['Thoroughly fed up.', 'Thoroughly fed up.']
    ],
    freezing: [
      ['Cold. Emotionally and literally.', 'Cold. Emotionally and literally.'],
      ['Bitter. In every sense.', 'Bitter. In every sense.']
    ],
    melting: [
      ['Overheating and unrepentant.', 'Overheating and unrepentant.'],
      ['Turned itself up to eleven.', 'Turned itself up to eleven.']
    ],
    questionable: [
      ['Questionable. Very questionable.', 'Questionable. Very questionable.'],
      ['Up to something.', 'Up to something.']
    ]
  };

  V.moodKind = function (forecast, now) {
    var n = W.now(forecast, now);
    var fam = W.family(n.code);
    if (fam === 'thunder' || n.gust >= 60) return 'tantrum';
    if (fam === 'snow' || fam === 'ice') return 'questionable';
    if (fam === 'fog') return 'questionable';
    if (fam === 'downpour') return 'sulking';
    if (fam === 'rain') return n.feels <= 5 ? 'sulking' : 'annoyed';
    if (fam === 'showers' || V.changeable(forecast, now)) return 'undecided';
    if (fam === 'drizzle') return 'annoyed';
    if (n.feels >= 30) return 'melting';
    if (n.feels <= -1) return 'freezing';
    if (fam === 'clear') {
      if (n.feels >= 24) return 'showingOff';
      if (n.feels >= 14) return 'delighted';
      return 'showingOff';
    }
    if (fam === 'grey') return 'unavailable';
    return 'wellBehaved';
  };

  V.mood = function (forecast, settings, now) {
    var kind = V.moodKind(forecast, now);
    var bank = MOODS[kind] || MOODS.wellBehaved;
    var seed = W.dayOf(now, forecast.offset) + ':' + W.hourOf(now, forecast.offset) + ':' + kind;
    return { kind: kind, text: choose(bank, seed, settings.sweary) };
  };

  /* ------------------------------------------------- how is it looking, then */

  /* The most useful thing in the app, and the least funny: the forecast in a
     sentence or three, the way a person would say it. Assembled entirely from
     the numbers — every clause below is a fact the forecast contains. */
  function warmth(t) {
    if (t >= 28) return 'Baking';
    if (t >= 23) return 'Warm';
    if (t >= 18) return 'Mild';
    if (t >= 12) return 'Cool';
    if (t >= 6) return 'Chilly';
    if (t >= 0) return 'Cold';
    return 'Freezing';
  }

  function skyOf(hours) {
    var count = {};
    hours.forEach(function (h) {
      var fam = W.family(h.code);
      count[fam] = (count[fam] || 0) + 1;
    });
    var best = 'cloud', most = 0;
    Object.keys(count).forEach(function (k) { if (count[k] > most) { most = count[k]; best = k; } });
    return best;
  }

  var SKY_WORDS = {
    clear: 'sunny', cloud: 'a mix of sun and cloud', grey: 'grey',
    drizzle: 'drizzly', rain: 'wet', downpour: 'very wet', showers: 'showery',
    snow: 'snowy', ice: 'icy', fog: 'foggy', thunder: 'stormy'
  };

  function partName(hour) {
    if (hour < 12) return 'this morning';
    if (hour < 17) return 'this afternoon';
    if (hour < 22) return 'this evening';
    return 'tonight';
  }

  V.brief = function (forecast, settings, now) {
    var hours = W.todayHours(forecast, now);
    /* Late in the evening there is no day left to describe, so the brief
       becomes tonight and tomorrow morning instead of pretending. */
    var borrowed = false;
    if (hours.length < 3) {
      hours = W.hoursFrom(forecast, now, 14);
      borrowed = true;
    }
    if (!hours.length) return '';

    var offset = forecast.offset;
    var temps = hours.map(function (h) { return h.temp; });
    var hi = Math.max.apply(null, temps), lo = Math.min.apply(null, temps);
    var sky = skyOf(hours);
    var wettest = hours.reduce(function (a, h) { return Math.max(a, h.prob || 0); }, 0);
    var gusty = hours.reduce(function (a, h) { return Math.max(a, h.gust); }, 0);
    var startHour = W.hourOf(hours[0].t, offset);

    var when = borrowed ? 'through the night and into tomorrow' : ('for the rest of ' + partName(startHour).replace('this ', 'the '));
    if (!borrowed && startHour < 10) when = 'today';

    /* Thunder in the hours ahead changes what the whole paragraph is about.
       "Rain is likely" is true of a thunderstorm and still the wrong sentence
       to read before walking out into one. */
    var stormy = hours.some(function (h) { return W.family(h.code) === 'thunder'; });

    var sentence = warmth(hi) + ', mostly ' + (SKY_WORDS[sky] || 'cloudy');
    if (stormy) sentence += ' ' + when + ', with thunderstorms in it.';
    else if (wettest < 25) sentence += ' and dry ' + when + '.';
    else if (wettest < 55) sentence += ' ' + when + ', with the odd shower about.';
    else sentence += ' ' + when + ', and rain is likely.';

    var out = [sentence];

    /* The one change that matters most, named with its time. */
    var moves = W.transitions(forecast, now, borrowed ? 14 : 12).filter(function (m) {
      return m.kind === 'stormStarts' || m.kind === 'rainStarts' || m.kind === 'rainStops' ||
        m.kind === 'brightens' || m.kind === 'clouds';
    });

    /* Earliest, unless a storm turns up later — a storm at four is more worth
       knowing than cloud at eleven, whatever order they happen in. */
    var storm = moves.filter(function (m) { return m.kind === 'stormStarts'; })[0];
    if (moves.length) {
      var m = storm || moves[0];
      var at = W.clock(m.t, offset, settings.ampm);
      if (m.kind === 'stormStarts') out.push('Storms from around ' + at + '.');
      else if (m.kind === 'rainStarts') out.push('Rain arrives around ' + at + '.');
      else if (m.kind === 'rainStops') out.push('It dries up around ' + at + '.');
      else if (m.kind === 'brightens') out.push('The sun gets through around ' + at + '.');
      else out.push('Cloud builds in around ' + at + '.');
    }

    /* And the thing you would want warning about, if there is one. A day that
       is already stormy when you open the app has no arrival time to give, so
       it gets said here instead of going unmentioned. */
    if (stormy && !storm) out.push('Thunder about — that is the bit to plan around.');
    else if (gusty >= 55) out.push('Windy with it — gusts to ' + W.speed(gusty, settings.units) + '.');
    else if (hi - lo >= 9) out.push('A big swing in temperature, ' + W.temp(lo, settings.units) + ' to ' + W.temp(hi, settings.units) + '.');
    else if (wettest < 20 && (sky === 'clear' || sky === 'cloud')) out.push('Nothing dramatic.');

    return out.join(' ');
  };

  /* ------------------------------------------------------- best and worst bit */

  var BEST = [
    ['THIS. THIS IS THE BIT.', 'THIS. THIS IS THE BIT.'],
    ['PEAK SKY. RIGHT THERE.', 'PEAK SKY. RIGHT THERE.'],
    ['IF YOU LOOK UP ONCE TODAY, MAKE IT THEN.', 'IF YOU LOOK UP ONCE TODAY, MAKE IT THEN.']
  ];
  var WORST = [
    ['AND THERE IT FUCKING IS.', 'AND THERE IT IS.'],
    ['THE LOW POINT, WEATHER-WISE.', 'THE LOW POINT, WEATHER-WISE.'],
    ['BRACE YOURSELF FOR THAT ONE.', 'BRACE YOURSELF FOR THAT ONE.']
  ];

  V.bestWorst = function (forecast, settings, now) {
    var hours = W.todayHours(forecast, now);
    /* One hour left is not a best and a worst, it is just an hour. */
    if (hours.length < 3) return null;
    var best = W.nicest(hours);
    var worst = W.grimmest(hours);
    if (!best || !worst || best.t === worst.t) return null;
    var seed = W.dayOf(now, forecast.offset);
    return {
      best: { hour: best, line: choose(BEST, seed + ':best', settings.sweary) },
      worst: { hour: worst, line: choose(WORST, seed + ':worst', settings.sweary) }
    };
  };

  /* ------------------------------------------------------------- tomorrow */

  /* Tomorrow, told as the difference from today rather than as a fact on its
     own. "Eighteen degrees and cloudy" is already on the card in numbers; what
     a person actually wants to know is whether that is better or worse than
     what they have just had.

     Eleven situations rather than three, because "warmer" and "a lot warmer"
     are different news, and because a cooler day that is dry and bright is not
     a worse day — calling it one would contradict the forecast sitting
     directly above it. */
  var TOMORROW = {
    /* Thunder, snow or ice arriving. Beats everything else on the card. */
    rough: [
      ['TOMORROW GETS FUCKING SERIOUS.', 'TOMORROW GETS SERIOUS.'],
      ['BATTEN THINGS DOWN FOR TOMORROW.', 'BATTEN THINGS DOWN FOR TOMORROW.']
    ],
    wetter: [
      ["TOMORROW'S THE WET ONE.", "TOMORROW'S THE WET ONE."],
      ['ENJOY TODAY. TOMORROW GETS WET.', 'ENJOY TODAY. TOMORROW GETS WET.']
    ],
    dryer: [
      ['TOMORROW DRIES THE HELL UP.', 'TOMORROW DRIES RIGHT UP.'],
      ['TOMORROW: NO RAIN. IMAGINE THAT.', 'TOMORROW: NO RAIN. IMAGINE THAT.']
    ],
    muchWarmer: [
      ['TOMORROW IS A LOT BLOODY WARMER.', 'TOMORROW IS A LOT WARMER.'],
      ['BIG JUMP UP TOMORROW.', 'BIG JUMP UP TOMORROW.']
    ],
    warmer: [
      ['TOMORROW LOOKS FUCKING PROMISING.', 'TOMORROW LOOKS SERIOUSLY PROMISING.'],
      ['TOMORROW JUST GOT BETTER.', 'TOMORROW JUST GOT BETTER.']
    ],
    muchColder: [
      ['TOMORROW FALLS OFF A BLOODY CLIFF.', 'TOMORROW FALLS OFF A CLIFF.'],
      ['BIG DROP TOMORROW. LAYER UP.', 'BIG DROP TOMORROW. LAYER UP.']
    ],
    /* Cooler, but dry and bright with it. Deliberately not filed under
       "worse". */
    coolerButFine: [
      ["TOMORROW'S COOLER — STILL DECENT.", "TOMORROW'S COOLER — STILL DECENT."],
      ['COOLER TOMORROW, AND STILL DRY.', 'COOLER TOMORROW, AND STILL DRY.']
    ],
    cooler: [
      ["TOMORROW'S A BIT OF A BASTARD.", "TOMORROW'S A BIT OF A STINKER."],
      ['ENJOY TODAY. TOMORROW TURNS.', 'ENJOY TODAY. TOMORROW TURNS.']
    ],
    cloudier: [
      ['TOMORROW IS TODAY WITH MORE CLOUD.', 'TOMORROW IS TODAY WITH MORE CLOUD.'],
      ['SAME AGAIN TOMORROW, BUT GREYER.', 'SAME AGAIN TOMORROW, BUT GREYER.']
    ],
    brighter: [
      ['TOMORROW CLEARS UP A BIT.', 'TOMORROW CLEARS UP A BIT.'],
      ['SAME AGAIN TOMORROW, BUT BRIGHTER.', 'SAME AGAIN TOMORROW, BUT BRIGHTER.']
    ],
    windier: [
      ['TOMORROW GETS BLOODY BREEZY.', 'TOMORROW GETS SERIOUSLY BREEZY.'],
      ['HANG ON TO YOUR HAT TOMORROW.', 'HANG ON TO YOUR HAT TOMORROW.']
    ],
    same: [
      ['MUCH THE SAME AGAIN TOMORROW.', 'MUCH THE SAME AGAIN TOMORROW.'],
      ['TOMORROW: MORE OF THIS.', 'TOMORROW: MORE OF THIS.'],
      ['ANOTHER ONE LIKE TODAY.', 'ANOTHER ONE LIKE TODAY.']
    ]
  };

  /* Added here rather than in the V.banks line above, which runs before this
     bank exists: `var` hoists the name but not the value, so listing it there
     would quietly export undefined and the test that walks every line in the
     app would walk straight past all of these. */
  V.banks.TOMORROW = TOMORROW;

  /* Where a day's sky sits on the bright-to-murky scale, so "more cloud" can
     be told from "brighter" and both from "wet". Only the dry families are
     ranked; anything falling out of the sky is handled before this. */
  var SKY_RANK = { clear: 0, cloud: 1, grey: 2, fog: 3 };
  var ROUGH_DAY = { thunder: 1, ice: 1, snow: 1 };

  function fallsOutOfTheSky(fam) {
    return fam === 'drizzle' || fam === 'showers' || fam === 'rain' ||
      fam === 'downpour' || fam === 'snow' || fam === 'thunder' || fam === 'ice';
  }

  /* The comparison, in priority order: the loudest true difference wins. Every
     branch is a fact about the two forecasts, so the line can never say
     something the numbers on the card disagree with. */
  function tomorrowKind(today, day) {
    if (!today) return 'same';

    var famToday = W.family(today.code);
    var famDay = W.family(day.code);

    /* Thunder, snow or ice arriving is the news, whatever else moved. */
    if (ROUGH_DAY[famDay] && !ROUGH_DAY[famToday]) return 'rough';

    var wetToday = fallsOutOfTheSky(famToday);
    var wetDay = fallsOutOfTheSky(famDay);

    /* A missing probability means the model has stopped offering one, not that
       it is zero — so an unknown can never be read as drying up. */
    var bothKnown = today.prob !== null && today.prob !== undefined &&
      day.prob !== null && day.prob !== undefined;
    var dryer = bothKnown ? today.prob - day.prob : 0;

    if ((wetDay && !wetToday) || dryer <= -35) return 'wetter';
    if ((wetToday && !wetDay) || dryer >= 35) return 'dryer';

    var warmer = (today.max === null || day.max === null) ? 0 : day.max - today.max;
    if (warmer >= 6) return 'muchWarmer';
    if (warmer <= -6) return 'muchColder';
    if (warmer >= 3) return 'warmer';
    if (warmer <= -3) {
      /* Cooler is not automatically worse. A cooler day that is dry and bright
         is a perfectly good day, and the card above says so. */
      return (!wetDay && SKY_RANK[famDay] <= 1) ? 'coolerButFine' : 'cooler';
    }

    /* Same sort of temperature, so the sky and the wind decide. */
    var gustJump = (day.gust || 0) - (today.gust || 0);
    if (gustJump >= 20 && (day.gust || 0) >= 45) return 'windier';

    var skyToday = SKY_RANK[famToday];
    var skyDay = SKY_RANK[famDay];
    if (skyToday !== undefined && skyDay !== undefined) {
      if (skyDay > skyToday) return 'cloudier';
      if (skyDay < skyToday) return 'brighter';
    }

    return 'same';
  }

  V.tomorrow = function (forecast, settings, now) {
    var i = W.todayIndex(forecast, now);
    var today = forecast.days[i];
    var day = forecast.days[i + 1];
    if (!day) return null;
    var kind = tomorrowKind(today, day);
    return {
      day: day,
      kind: kind,
      line: choose(TOMORROW[kind], day.t + ':' + kind, settings.sweary)
    };
  };

  /* --------------------------------------------------------------- warnings */

  /* The lead-in to a real warning. Light, never flippant — the detail under it
     comes from weather.js and is never funny. */
  var ALERT_HEADS = [
    ['BIT SERIOUS OUT THERE', 'BIT SERIOUS OUT THERE'],
    ['WORTH KNOWING', 'WORTH KNOWING'],
    ['HEADS UP', 'HEADS UP']
  ];
  V.alertHead = function (alert, settings) {
    return choose(ALERT_HEADS, alert.kind, settings.sweary);
  };

  /* -------------------------------------------------------- what has changed */

  var CHANGES = {
    warmer: [
      ['{when} JUST GOT FUCKING BETTER — UP {by}°.', '{when} JUST GOT BETTER — UP {by}°.'],
      ['THE FORECAST HAS WARMED {when} BY {by}°.', 'THE FORECAST HAS WARMED {when} BY {by}°.']
    ],
    colder: [
      ['WHO TURNED THE HEATING OFF? {when} IS DOWN {by}°.', 'WHO TURNED THE HEATING OFF? {when} IS DOWN {by}°.'],
      ['{when} HAS DROPPED {by}° SINCE THE LAST LOOK.', '{when} HAS DROPPED {by}° SINCE THE LAST LOOK.']
    ],
    wetter: [
      ['SMALL PROBLEM: THE RAIN HAS MADE PLANS FOR {when}.', 'SMALL PROBLEM: THE RAIN HAS MADE PLANS FOR {when}.'],
      ['{when} HAS GOT WETTER. SORRY.', '{when} HAS GOT WETTER. SORRY.']
    ],
    dryer: [
      ["WE'VE FOUND A PATCH OF SUNSHINE — {when} IS DRYING OUT.", "WE'VE FOUND A PATCH OF SUNSHINE — {when} IS DRYING OUT."],
      ['{when} IS LOOKING DRIER THAN IT DID.', '{when} IS LOOKING DRIER THAN IT DID.']
    ]
  };

  V.changeLines = function (changes, settings) {
    return changes.map(function (c) {
      var text = choose(CHANGES[c.kind] || CHANGES.warmer, c.kind + ':' + c.when, settings.sweary);
      var when = c.when.charAt(0).toUpperCase() + c.when.slice(1);
      return {
        key: c.kind,
        icon: c.kind === 'warmer' ? '🌞' : (c.kind === 'colder' ? '🥶' : (c.kind === 'wetter' ? '☔' : '🌤️')),
        text: fill(text, { when: when, by: c.by })
      };
    });
  };

  root.Voice = V;

})(typeof self !== 'undefined' ? self : this);
