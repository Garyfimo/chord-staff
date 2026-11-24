// js/music-theory.js
// Pure music-theory constants and helpers. No DOM, no state, no Firebase.
// Exports onto window.App.musicTheory for other modules to consume.
(function () {
  'use strict';
  const App = (window.App = window.App || {});

  const LETTERS = ['C','D','E','F','G','A','B'];
  const LETTER_PITCHES = [0, 2, 4, 5, 7, 9, 11];
  const ROOTS = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  const QUALITIES = [
    { id: '',    label: 'Major',  formula: [0, 4, 7],     stack: 'thirds' },
    { id: 'm',   label: 'Minor',  formula: [0, 3, 7],     stack: 'thirds' },
    { id: '7',   label: '7',      formula: [0, 4, 7, 10], stack: 'thirds' },
    { id: 'maj7',label: 'Maj7',   formula: [0, 4, 7, 11], stack: 'thirds' },
    { id: 'm7',  label: 'min7',   formula: [0, 3, 7, 10], stack: 'thirds' },
    { id: 'dim', label: 'Dim',    formula: [0, 3, 6],     stack: 'thirds' },
    { id: 'sus4',label: 'Sus4',   formula: [0, 5, 7],     stack: 'sus4' },
    { id: '5',   label: 'Power',  formula: [0, 7],        stack: 'fifth' },
  ];
  const DURATIONS = {
    whole:   { beats: 4,   hollow: true,  stem: false, flags: 0 },
    half:    { beats: 2,   hollow: true,  stem: true,  flags: 0 },
    quarter: { beats: 1,   hollow: false, stem: true,  flags: 0 },
    eighth:  { beats: 0.5, hollow: false, stem: true,  flags: 1 },
  };
  const TIME_SIGS = ['2/4', '3/4', '4/4', '6/8', '5/4', '3/8'];
  function parseTime(sig) {
    const parts = String(sig || '4/4').split('/');
    return { num: parseInt(parts[0], 10) || 4, den: parseInt(parts[1], 10) || 4 };
  }
  function measureBeats(time) {
    // Returns duration of one measure in quarter-note beats
    return time.num * (4 / time.den);
  }
  // Find the largest duration (whole > half > quarter > eighth) that fits within `beats`.
  const DURATION_ORDER = ['whole', 'half', 'quarter', 'eighth'];
  function fitDurationToMeasure(durId, beats) {
    const current = DURATIONS[durId] || DURATIONS.quarter;
    if (current.beats <= beats) return durId;
    for (let i = 0; i < DURATION_ORDER.length; i++) {
      if (DURATIONS[DURATION_ORDER[i]].beats <= beats) return DURATION_ORDER[i];
    }
    return 'eighth';
  }
  // Dotted-aware beat count for an event (dot = ×1.5).
  function durationBeats(durId, dotted) {
    const b = (DURATIONS[durId] || DURATIONS.quarter).beats;
    return dotted ? b * 1.5 : b;
  }
  function eventBeats(evt) {
    return durationBeats(eventDuration(evt), !!(evt && evt.dotted));
  }
  // Prefer keeping the requested duration (drop the dot before shrinking),
  // then fall back to the next smaller duration — dotted first if it fits.
  function fitEventToMeasure(durId, dotted, beats) {
    if (dotted && durationBeats(durId, true) <= beats + 1e-9) return { duration: durId, dotted: true };
    if (durationBeats(durId, false) <= beats + 1e-9) return { duration: durId, dotted: false };
    for (let i = 0; i < DURATION_ORDER.length; i++) {
      const d = DURATION_ORDER[i];
      if (dotted && durationBeats(d, true) <= beats + 1e-9) return { duration: d, dotted: true };
      if (durationBeats(d, false) <= beats + 1e-9) return { duration: d, dotted: false };
    }
    return { duration: 'eighth', dotted: false };
  }
  function fitSystemDurations(sys) {
    const mBeats = measureBeats(parseTime(sys.time));
    let changed = 0;
    const contents = [sys.content];
    if (sys.kind === 'piano' && sys.bassContent) contents.push(sys.bassContent);
    contents.forEach(function (contentMap) {
      Object.keys(contentMap).forEach(function (k) {
        const cell = contentMap[k];
        const evts = measureEvents(cell);
        if (!evts.length) return;
        const kept = [];
        let acc = 0;
        for (let i = 0; i < evts.length; i++) {
          const e = evts[i];
          const remaining = mBeats - acc;
          if (remaining <= 0) { changed++; continue; }
          const curDur = eventDuration(e);
          const curDot = !!e.dotted;
          const fitted = fitEventToMeasure(curDur, curDot, remaining);
          if (fitted.duration !== curDur) { e.duration = fitted.duration; changed++; }
          if (fitted.dotted !== curDot) {
            if (fitted.dotted) e.dotted = true; else delete e.dotted;
            changed++;
          }
          kept.push(e);
          acc += eventBeats(e);
        }
        setMeasureIn(contentMap, k, kept);
      });
    });
    return changed;
  }
  const SHARP_ORDER = ['F','C','G','D','A','E','B'];
  const FLAT_ORDER  = ['B','E','A','D','G','C','F'];
  const SHARP_POS = { F:10, C:7, G:11, D:8, A:5, E:9, B:6 };
  const FLAT_POS  = { B:6, E:9, A:5, D:8, G:4, C:7, F:3 };
  // Bass-clef positions (bottom line = G2 = position 2)
  const BASS_SHARP_POS = { F:8, C:5, G:9, D:6, A:3, E:7, B:4 };
  const BASS_FLAT_POS  = { B:4, E:7, A:3, D:6, G:2, C:5, F:8 };
  // Each clef maps diatonic absolute number (octave*7 + letterIdx, C=0) to its own position space
  // Treble: position 0 = C4 (abs 28). Bass: position 0 = E2 (abs 16).
  const CLEFS = {
    treble: { base: 28, startOctave: 4, glyph: '𝄞', glyphFontSize: 86, glyphYOffset: 6 },
    bass:   { base: 16, startOctave: 2, glyph: '𝄢', glyphFontSize: 56, glyphYOffset: -24 },
  };
  const KEYS = {
    'C':{sharps:0,flats:0,rel:'A'}, 'G':{sharps:1,flats:0,rel:'E'},
    'D':{sharps:2,flats:0,rel:'B'}, 'A':{sharps:3,flats:0,rel:'F#'},
    'E':{sharps:4,flats:0,rel:'C#'},'B':{sharps:5,flats:0,rel:'G#'},
    'F#':{sharps:6,flats:0,rel:'D#'},'Gb':{sharps:0,flats:6,rel:'Eb'},
    'Db':{sharps:0,flats:5,rel:'Bb'},'Ab':{sharps:0,flats:4,rel:'F'},
    'Eb':{sharps:0,flats:3,rel:'C'},'Bb':{sharps:0,flats:2,rel:'G'},
    'F':{sharps:0,flats:1,rel:'D'},
  };
  const CIRCLE_KEYS = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F'];

  function keySignatureAccidentals(key, clef) {
    clef = clef || 'treble';
    const info = KEYS[key] || KEYS.C;
    const SP = clef === 'bass' ? BASS_SHARP_POS : SHARP_POS;
    const FP = clef === 'bass' ? BASS_FLAT_POS : FLAT_POS;
    if (info.sharps > 0) {
      return SHARP_ORDER.slice(0, info.sharps).map(function (letter) {
        return { letter: letter, accidental: 1, position: SP[letter] };
      });
    } else if (info.flats > 0) {
      return FLAT_ORDER.slice(0, info.flats).map(function (letter) {
        return { letter: letter, accidental: -1, position: FP[letter] };
      });
    }
    return [];
  }
  function keySignatureWidth(key) {
    const n = keySignatureAccidentals(key).length;
    return n === 0 ? 0 : (n * 8 + 6);
  }
  function diatonicChords(key) {
    const info = KEYS[key] || KEYS.C;
    const rootPitch = LETTER_PITCHES[LETTERS.indexOf(key[0])] + (key.length > 1 ? (key[1] === '#' ? 1 : -1) : 0);
    const scale = [0, 2, 4, 5, 7, 9, 11];
    const qualities = ['', 'm', 'm', '', '', 'm', 'dim'];
    const degrees = ['I','ii','iii','IV','V','vi','vii°'];
    const useFlats = info.flats > 0;
    const sharpNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const flatNames  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
    return scale.map(function (step, i) {
      const pc = ((rootPitch + step) % 12 + 12) % 12;
      const name = (useFlats ? flatNames : sharpNames)[pc];
      return { degree: degrees[i], root: name, quality: qualities[i], label: name + (qualities[i] === 'dim' ? '°' : qualities[i]) };
    });
  }

  function prettyRoot(r) { return r.replace('#', '♯').replace('b', '♭'); }
  function prettyKey(k) { return prettyRoot(k) + ' major'; }
  function prettyQualitySuffix(id) {
    if (id === '') return '';
    if (id === 'm') return 'm';
    if (id === 'maj7') return 'maj7';
    if (id === 'm7') return 'm7';
    if (id === 'dim') return '°';
    if (id === 'sus4') return 'sus4';
    if (id === '5') return '5';
    return id;
  }
  function chordName(root, quality) { return prettyRoot(root) + prettyQualitySuffix(quality); }

  function chordNotes(root, qualityId, clef) {
    clef = clef || 'treble';
    const cfg = CLEFS[clef];
    const rootLetter = root[0];
    const rootAcc = root.length > 1 ? (root[1] === '#' ? 1 : -1) : 0;
    const rootLetterIdx = LETTERS.indexOf(rootLetter);
    const rootPitch = ((LETTER_PITCHES[rootLetterIdx] + rootAcc) % 12 + 12) % 12;
    const q = QUALITIES.find(function (x) { return x.id === qualityId; });
    const formula = q.formula;
    const notes = [];
    for (let i = 0; i < formula.length; i++) {
      let letterStep;
      if (q.stack === 'sus4') letterStep = i === 0 ? 0 : (i === 1 ? 3 : 4);
      else if (q.stack === 'fifth') letterStep = i === 0 ? 0 : 4;
      else letterStep = i * 2;
      const noteLetterIdx = (rootLetterIdx + letterStep) % 7;
      const letterNatural = LETTER_PITCHES[noteLetterIdx];
      const target = (rootPitch + formula[i]) % 12;
      let acc = target - letterNatural;
      if (acc > 6) acc -= 12;
      if (acc < -6) acc += 12;
      notes.push({ letter: LETTERS[noteLetterIdx], accidental: acc });
    }
    let octave = cfg.startOctave, prevPos = -Infinity;
    const result = [];
    for (let i = 0; i < notes.length; i++) {
      const idx = LETTERS.indexOf(notes[i].letter);
      let pos = octave * 7 + idx - cfg.base;
      while (pos <= prevPos) { octave++; pos = octave * 7 + idx - cfg.base; }
      result.push({ letter: notes[i].letter, accidental: notes[i].accidental, octave: octave, position: pos });
      prevPos = pos;
    }
    return result;
  }
  function noteLabel(n) {
    const acc = n.accidental === 1 ? '♯' : n.accidental === -1 ? '♭' : n.accidental === 2 ? '𝄪' : n.accidental === -2 ? '𝄫' : '';
    return n.letter + acc;
  }
  function letterAtPosition(position, clef) {
    const abs = CLEFS[clef || 'treble'].base + position;
    const letterIdx = ((abs % 7) + 7) % 7;
    return LETTERS[letterIdx];
  }
  // When the user hasn't picked a sharp/flat explicitly (Natural = 0), inherit the key signature's
  // accidental for the note's letter — so e.g. placing on the F line in G major gives F♯ by default.
  function effectiveAccidental(letter, selectedAcc, key) {
    if (selectedAcc !== 0) return selectedAcc;
    const accs = keySignatureAccidentals(key);
    const ks = accs.find(function (a) { return a.letter === letter; });
    return ks ? ks.accidental : 0;
  }
  function noteLabels(notes) {
    return (notes || []).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); }).map(noteLabel).join(' ');
  }
  function expandNote(n, clef) {
    clef = clef || 'treble';
    const abs = CLEFS[clef].base + n.position;
    const letterIdx = ((abs % 7) + 7) % 7;
    const octave = Math.floor(abs / 7);
    return { letter: LETTERS[letterIdx], accidental: n.accidental || 0, octave: octave, position: n.position };
  }
  function eventNotes(evt, clef) {
    if (!evt) return [];
    if (evt.kind === 'chord') return chordNotes(evt.root, evt.quality, clef);
    if (evt.kind === 'notes') return (evt.notes || []).map(function (n) { return expandNote(n, clef); });
    return [];
  }
  function staffKey(system, staff) {
    if (staff === 'bass' && system && system.kind === 'piano' && system.bassKey) return system.bassKey;
    return state.key;
  }
  // Apply the key signature's accidental to notes whose stored accidental is 0
  // (used for labels and playback, NOT for drawing accidental glyphs).
  function applyKeyToNotes(notes, key) {
    if (!key) return notes;
    return notes.map(function (n) {
      const acc = effectiveAccidental(n.letter, n.accidental || 0, key);
      return Object.assign({}, n, { accidental: acc });
    });
  }
  function eventDuration(evt) {
    return (evt && DURATIONS[evt.duration]) ? evt.duration : 'quarter';
  }
  function measureEvents(cell) {
    if (!cell) return [];
    if (Array.isArray(cell.events)) return cell.events;
    if (cell.kind) return [cell];
    return [];
  }
  function usedBeats(evts) {
    let total = 0;
    for (let i = 0; i < evts.length; i++) total += eventBeats(evts[i]);
    return total;
  }
  function setMeasure(sys, slot, events, staff) {
    const content = systemContent(sys, staff || 'treble');
    setMeasureIn(content, slot, events);
  }
  function setMeasureIn(content, slot, events) {
    if (!events || events.length === 0) delete content[slot];
    else content[slot] = { events: events.slice() };
  }
  // Returns [{evt, startBeat, beats}] for each event in a measure
  function layoutEvents(cell) {
    const evts = measureEvents(cell);
    let acc = 0;
    return evts.map(function (e) {
      const b = eventBeats(e);
      const item = { evt: e, startBeat: acc, beats: b };
      acc += b;
      return item;
    });
  }
  function migrateContent(content) {
    if (!content || typeof content !== 'object') return {};
    const out = {};
    Object.keys(content).forEach(function (k) {
      const c = content[k];
      if (!c) return;
      if (Array.isArray(c.events)) out[k] = { events: c.events };
      else if (c.kind) out[k] = { events: [c] };
    });
    return out;
  }


  App.musicTheory = {
    // constants
    LETTERS, LETTER_PITCHES, ROOTS, QUALITIES,
    DURATIONS, TIME_SIGS, DURATION_ORDER,
    SHARP_ORDER, FLAT_ORDER, SHARP_POS, FLAT_POS,
    BASS_SHARP_POS, BASS_FLAT_POS, CLEFS, KEYS, CIRCLE_KEYS,
    // functions
    parseTime, measureBeats,
    fitDurationToMeasure, durationBeats, eventBeats, fitEventToMeasure,
    fitSystemDurations,
    keySignatureAccidentals, keySignatureWidth, diatonicChords,
    prettyRoot, prettyKey, prettyQualitySuffix, chordName, chordNotes,
    noteLabel, letterAtPosition, effectiveAccidental, noteLabels,
    expandNote, eventNotes, staffKey, applyKeyToNotes,
    eventDuration, measureEvents, usedBeats,
    setMeasure, setMeasureIn, layoutEvents, migrateContent,
  };
})();
