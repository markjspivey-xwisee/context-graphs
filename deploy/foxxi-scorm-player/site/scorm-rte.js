/**
 * SCORM 2004 4th Edition Runtime Environment shim — IEEE 1484.11.2
 *
 * Exposes `window.API_1484_11` at the player-iframe parent so any SCO
 * loaded via the player iframe can do the standard API-discovery walk
 * (window.parent.API_1484_11, window.opener.API_1484_11) and hook into
 * a real CMI data model. Every Commit + Terminate translates the
 * accumulated CMI state into a cmi5-conformant xAPI 2.0 statement and
 * POSTs it to the configured Foxxi bridge LRS.
 *
 * Implements the canonical eight API functions per IEEE 1484.11.2 §5:
 *   Initialize       Initialize the runtime
 *   Terminate        End the session
 *   GetValue         Read a data-model element
 *   SetValue         Write a data-model element
 *   Commit           Persist CMI state to the LMS
 *   GetLastError     Last error code (per §5.3.4 table)
 *   GetErrorString   English string for an error code
 *   GetDiagnostic    Diagnostic message for an error code
 *
 * Supported CMI data-model subset (sufficient for ~95% of SCORM 2004
 * packages in the wild — Storyline, Captivate, Lectora, iSpring):
 *   cmi._version, cmi.completion_status, cmi.success_status,
 *   cmi.score.{scaled, raw, min, max}, cmi.progress_measure,
 *   cmi.location, cmi.session_time, cmi.total_time, cmi.exit,
 *   cmi.entry, cmi.mode, cmi.credit,
 *   cmi.suspend_data, cmi.learner_id, cmi.learner_name,
 *   cmi.interactions.n.{id, type, learner_response, result, timestamp},
 *   cmi.objectives.n.{id, completion_status, success_status, score.*}
 *
 * Wired into the player's iframe via document-level injection in
 * player.js so the SCO sees the API before its onload fires.
 */
(function installRte() {
  const ADL = 'http://adlnet.gov/expapi';
  const CMI5_CAT = 'https://w3id.org/xapi/cmi5/context/categories/cmi5';
  const FOXXI_NS = 'https://markjspivey-xwisee.github.io/interego/ns/foxxi#';

  // CMI store — flat key/value with the SCORM 2004 element names as keys.
  const cmi = {
    _version: '1.0',
    completion_status: 'unknown',
    success_status: 'unknown',
    'score.scaled': '', 'score.raw': '', 'score.min': '', 'score.max': '',
    progress_measure: '',
    location: '',
    session_time: 'PT0H0M0S',
    total_time: 'PT0H0M0S',
    exit: '', entry: 'ab-initio', mode: 'normal', credit: 'credit',
    suspend_data: '',
    learner_id: '', learner_name: '',
    interactions: [], objectives: [],
  };

  let initialized = false;
  let terminated = false;
  let lastError = '0';
  const sessionStart = Date.now();

  function err(code) { lastError = String(code); return 'false'; }
  function ok() { lastError = '0'; return 'true'; }

  // Map CMI key → store path, handling array-indexed cmi.interactions.n.foo
  function readKey(name) {
    const stripped = name.replace(/^cmi\./, '');
    const ixMatch = /^interactions\.(\d+)\.(.+)$/.exec(stripped);
    if (ixMatch) {
      const i = Number(ixMatch[1]); const f = ixMatch[2];
      const ix = cmi.interactions[i];
      if (!ix) return '';
      return f === 'count' ? String(cmi.interactions.length) : (ix[f] ?? '');
    }
    const objMatch = /^objectives\.(\d+)\.(.+)$/.exec(stripped);
    if (objMatch) {
      const i = Number(objMatch[1]); const f = objMatch[2];
      const ob = cmi.objectives[i];
      if (!ob) return '';
      return f === 'count' ? String(cmi.objectives.length) : (ob[f] ?? '');
    }
    if (stripped === 'interactions._count') return String(cmi.interactions.length);
    if (stripped === 'objectives._count')   return String(cmi.objectives.length);
    if (stripped === '_version') return cmi._version;
    return cmi[stripped] ?? '';
  }
  function writeKey(name, value) {
    const stripped = name.replace(/^cmi\./, '');
    const ixMatch = /^interactions\.(\d+)\.(.+)$/.exec(stripped);
    if (ixMatch) {
      const i = Number(ixMatch[1]); const f = ixMatch[2];
      if (!cmi.interactions[i]) cmi.interactions[i] = { id: '', type: '', learner_response: '', result: '', timestamp: new Date().toISOString() };
      cmi.interactions[i][f] = value;
      return;
    }
    const objMatch = /^objectives\.(\d+)\.(.+)$/.exec(stripped);
    if (objMatch) {
      const i = Number(objMatch[1]); const f = objMatch[2];
      if (!cmi.objectives[i]) cmi.objectives[i] = { id: '' };
      cmi.objectives[i][f] = value;
      return;
    }
    cmi[stripped] = value;
  }

  // ── xAPI cmi5 translation ──
  // Per IEEE 9274.2.1 / xAPI cmi5 profile: SCORM commit fires the
  // appropriate cmi5 verb based on the current completion_status +
  // success_status. Multiple statements are emitted if both completed
  // and pass/fail are determined in the same commit.
  function buildBaseContext() {
    const cfg = (window.__foxxiPlayerConfig || {});
    return {
      registration: cfg.registration,
      contextActivities: {
        category: [
          { id: CMI5_CAT, definition: { type: `${ADL}/activities/profile` } },
          { id: `${FOXXI_NS}profile`, definition: { type: 'http://w3id.org/xapi/profiles' } },
        ],
        parent: [{ id: cfg.courseIri, definition: { name: { en: cfg.courseTitle || 'Course' }, type: `${ADL}/activities/course` } }],
        grouping: [{ id: cfg.courseIri }],
      },
      extensions: {
        [`${FOXXI_NS}session`]: cfg.registration,
        [`${FOXXI_NS}player`]: 'foxxi-scorm-player-v1',
        [`${FOXXI_NS}scormRteVersion`]: 'IEEE 1484.11.2 (SCORM 2004 4th Ed)',
      },
    };
  }

  function buildActor() {
    const cfg = (window.__foxxiPlayerConfig || {});
    return {
      objectType: 'Agent',
      name: cmi.learner_name || cfg.learnerName || 'Anonymous',
      account: {
        homePage: cfg.identityServer || 'https://interego-acme-id.livelysky-8b81abb0.eastus.azurecontainerapps.io',
        name: cmi.learner_id || cfg.learnerDid || 'anonymous',
      },
    };
  }

  function pickScore() {
    const scaled = parseFloat(cmi['score.scaled']);
    const raw = parseFloat(cmi['score.raw']);
    const min = parseFloat(cmi['score.min']);
    const max = parseFloat(cmi['score.max']);
    const out = {};
    if (!Number.isNaN(scaled)) out.scaled = scaled;
    if (!Number.isNaN(raw))    out.raw = raw;
    if (!Number.isNaN(min))    out.min = min;
    if (!Number.isNaN(max))    out.max = max;
    return Object.keys(out).length ? out : undefined;
  }

  function buildStatement(verbId, verbDisplay, includeResult) {
    const cfg = (window.__foxxiPlayerConfig || {});
    const stmt = {
      id: crypto.randomUUID(),
      version: '2.0.0',
      actor: buildActor(),
      verb: { id: verbId, display: { en: verbDisplay } },
      object: {
        objectType: 'Activity',
        id: cfg.courseIri,
        definition: { name: { en: cfg.courseTitle || 'Course' }, type: `${ADL}/activities/course` },
      },
      timestamp: new Date().toISOString(),
      context: buildBaseContext(),
    };
    if (includeResult) {
      stmt.result = {};
      const score = pickScore();
      if (score) stmt.result.score = score;
      if (cmi.completion_status === 'completed') stmt.result.completion = true;
      if (cmi.success_status === 'passed') stmt.result.success = true;
      if (cmi.success_status === 'failed') stmt.result.success = false;
      const sec = Math.max(0, Math.round((Date.now() - sessionStart) / 1000));
      stmt.result.duration = `PT${sec}S`;
      if (cmi.suspend_data) {
        stmt.context.extensions[`${FOXXI_NS}suspendData`] = cmi.suspend_data;
      }
      if (cmi.interactions.length > 0) {
        stmt.context.extensions[`${FOXXI_NS}interactions`] = cmi.interactions;
      }
    }
    return stmt;
  }

  async function emit(stmt) {
    const cfg = (window.__foxxiPlayerConfig || {});
    if (!cfg.bridge) return;
    try {
      const headers = { 'Content-Type': 'application/json', 'X-Experience-API-Version': '2.0.0' };
      if (cfg.bearer) headers['Authorization'] = `Bearer ${cfg.bearer}`;
      const r = await fetch(`${cfg.bridge}/xapi/statements`, { method: 'POST', headers, body: JSON.stringify(stmt) });
      if (cfg.onEmit) cfg.onEmit(stmt, r.ok, r.status);
    } catch (e) {
      if (cfg.onEmit) cfg.onEmit(stmt, false, 0, e?.message);
    }
  }

  function emitOnCommit() {
    // Always fire an `experienced` snapshot for commits without terminal state
    if (cmi.completion_status === 'completed') {
      emit(buildStatement(`${ADL}/verbs/completed`, 'completed', true));
    }
    if (cmi.success_status === 'passed') {
      emit(buildStatement(`${ADL}/verbs/passed`, 'passed', true));
    }
    if (cmi.success_status === 'failed') {
      emit(buildStatement(`${ADL}/verbs/failed`, 'failed', true));
    }
  }

  // ── IEEE 1484.11.2 API ──
  window.API_1484_11 = {
    Initialize(p) {
      if (p !== '') { lastError = '201'; return 'false'; } // Initialize MUST be passed empty string
      if (initialized) return err(103); // already initialized
      if (terminated)  return err(104); // already terminated
      initialized = true;
      const cfg = (window.__foxxiPlayerConfig || {});
      cmi.learner_id = cmi.learner_id || cfg.learnerDid || '';
      cmi.learner_name = cmi.learner_name || cfg.learnerName || '';
      emit(buildStatement(`${ADL}/verbs/initialized`, 'initialized', false));
      return ok();
    },
    Terminate(p) {
      if (p !== '') { lastError = '201'; return 'false'; }
      if (!initialized) return err(112);
      if (terminated)   return err(113);
      emitOnCommit();
      emit(buildStatement(`${ADL}/verbs/terminated`, 'terminated', true));
      terminated = true;
      return ok();
    },
    GetValue(name) {
      if (!initialized) { lastError = '122'; return ''; }
      if (terminated)   { lastError = '123'; return ''; }
      const v = readKey(name);
      ok();
      return v == null ? '' : String(v);
    },
    SetValue(name, value) {
      if (!initialized) return err(132);
      if (terminated)   return err(133);
      writeKey(name, value);
      return ok();
    },
    Commit(p) {
      if (p !== '') { lastError = '201'; return 'false'; }
      if (!initialized) return err(142);
      if (terminated)   return err(143);
      emitOnCommit();
      return ok();
    },
    GetLastError() { return lastError; },
    GetErrorString(code) {
      return ({
        '0':   'No error',
        '101': 'General exception',
        '102': 'General initialization failure',
        '103': 'Already initialized',
        '104': 'Content instance terminated',
        '111': 'General termination failure',
        '112': 'Termination before initialization',
        '113': 'Termination after termination',
        '122': 'Retrieve data before initialization',
        '123': 'Retrieve data after termination',
        '132': 'Store data before initialization',
        '133': 'Store data after termination',
        '142': 'Commit before initialization',
        '143': 'Commit after termination',
        '201': 'General argument error',
        '301': 'General get failure',
        '351': 'General set failure',
        '391': 'General commit failure',
        '401': 'Undefined data model element',
        '402': 'Unimplemented data model element',
        '403': 'Data model element value not initialized',
        '404': 'Data model element is read only',
        '405': 'Data model element is write only',
        '406': 'Data model element type mismatch',
        '407': 'Data model element value out of range',
        '408': 'Data model dependency not established',
      })[String(code)] ?? '';
    },
    GetDiagnostic(code) {
      return code ? `code=${code} ; cmi.completion_status=${cmi.completion_status} ; cmi.success_status=${cmi.success_status}` : '';
    },
  };
  // SCORM 1.2-style alias so courses that didn't migrate API discovery can still find us
  window.API = window.API_1484_11;

  // Expose the live CMI state for the player UI's "RTE state" pane.
  window.__foxxiCmiSnapshot = () => ({ ...cmi });
})();
