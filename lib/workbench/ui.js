import { attachKeypad } from './keypad.js';
import { renderFlowGraph } from './graph.js';

const $ = id => document.getElementById(id);
const snapshots = new Map();
const numbers = new Map();
let selected = null;
let nextNumber = 1;
let busy = false;
let config;
let replaySession = null;
let replayTurns = null;
let replaySource = '';
let replayFilename = 'regression.test.js';

const messages = {
  SESSION_LIMIT: 'Close a session before creating another.',
  SESSION_BUSY: 'This session is processing a turn. Wait for it to finish.',
  SESSION_CLOSED: 'This session has ended or expired. Reset to start again.',
  SESSION_NOT_FOUND: 'The session is no longer available. Create a new session.',
  TURN_FAILED: 'The turn failed. Inspect its outcome below, then reset or try another reply.',
  RESPONSE_TOO_LARGE: 'The response exceeds the local display limit.',
  REPLAY_NOT_CONFIGURED: 'This flow needs a separate replay factory before it can replay or export tests.',
  INVALID_FIXTURE: 'The scenario is not a valid v1 fixture. Check its fields, values and size.',
  SYNTHETIC_REPLACEMENTS_REQUIRED: 'Replace all input placeholders and redacted aliases with synthetic values before replay.',
  FAKE_RESPONSE_REQUIRED: 'A named fake response is missing from this flow’s replay configuration.',
  UNSCRIPTED_EFFECT: 'The flow called an external operation that was not scripted for this turn.',
  UNCONSUMED_EFFECT: 'A scripted external operation was not called by this turn.',
  EXPECTATION_MISMATCH: 'Replay did not match the expected state or outcome.',
  NON_MONOTONIC_CLOCK: 'Turn and external-effect times must move forward.',
  FLOW_VERSION_MISMATCH: 'The scenario must use the selected flow version.',
  INCOMPLETE_HISTORY: 'Earlier turns have been dropped. Reset and capture a complete session before exporting.',
  EXPORT_NEEDS_1_TO_64_TURNS: 'A draft needs a complete history of 1–64 turns.',
  INVALID_INPUT: 'Replies must be text of at most 160 characters.'
};

async function request(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error((messages[result.error] || 'The workbench could not complete this request.') + (result.turn ? ` Turn ${result.turn}.` : ''));
    error.code = result.error;
    throw error;
  }
  return result;
}

function notice(text, tone = '') {
  $('notice').textContent = text;
  $('notice').dataset.tone = tone;
}

function lock(value) {
  busy = value;
  $('new-session').disabled = value;
  $('flow').disabled = value;
  $('close-session').disabled = value || !selected;
  document.querySelectorAll('.session-tab').forEach(button => { button.disabled = value; });
  replayControls();
}

function renderSessions() {
  $('session-count').textContent = `${snapshots.size} / ${config.maxSessions}`;
  $('sessions').replaceChildren(...[...snapshots.values()].map(session => {
    const button = document.createElement('button');
    button.className = 'session-tab';
    button.type = 'button';
    button.setAttribute('aria-pressed', String(session.id === selected));
    const title = document.createElement('strong');
    title.textContent = `Session ${numbers.get(session.id)}`;
    const detail = document.createElement('span');
    detail.textContent = `${session.state || 'Not started'} · ${session.status}`;
    button.append(title, detail);
    button.addEventListener('click', () => {
      if (busy) return;
      void action(async () => {
        const snapshot = await request(`/api/sessions/${session.id}`);
        selected = session.id;
        render(snapshot);
      });
    });
    return button;
  }));
}

function replayControls() {
  const snapshot = snapshots.get(selected);
  const enabled = config?.flows.find(flow => flow.id === snapshot?.flowId)?.replayEnabled;
  $('replay-fixture').disabled = busy || !enabled;
  $('replay-draft').disabled = busy || !enabled || !snapshot?.totalTurns;
  $('replay-run').disabled = $('replay-export').disabled = busy || !enabled || !$('replay-fixture').value.trim();
  $('replay-download').disabled = busy || !replaySource;
  $('replay-availability').textContent = enabled ? 'Synthetic only' : 'Replay factory required';
}

function renderReplay(snapshot) {
  if (replaySession !== snapshot.id || replayTurns !== snapshot.totalTurns) {
    replaySession = snapshot.id;
    replayTurns = snapshot.totalTurns;
    $('replay-fixture').value = '';
    replaySource = '';
    $('replay-source').textContent = 'No test generated.';
    $('replay-fixture').removeAttribute('aria-invalid');
    $('replay-result').textContent = 'Replay runs in a fresh machine with a virtual clock, memory storage and fake dependencies.';
  }
  replayControls();
}

function showExport(result) {
  $('replay-fixture').value = JSON.stringify(result.fixture, null, 2);
  replaySource = result.testSource;
  replayFilename = `${result.fixture.caseId}.test.js`;
  $('replay-source').textContent = replaySource;
  $('replay-result').textContent = result.draft.provenance === 'captured-redacted' ?
    'Draft ready. Inputs and external dependencies were not recorded. Replace placeholders and add fake effects; choose the expected fixed behavior.' :
    'Jest test generated. Run replay to verify its expectations before using it in CI.';
}

function readScenario() {
  $('replay-fixture').removeAttribute('aria-invalid');
  try { return JSON.parse($('replay-fixture').value); }
  catch { const error = new Error(messages.INVALID_FIXTURE); error.code = 'INVALID_FIXTURE'; throw error; }
}
function scenarioError(error) {
  $('replay-result').textContent = error.message;
  if (['INVALID_FIXTURE', 'SYNTHETIC_REPLACEMENTS_REQUIRED'].includes(error.code)) $('replay-fixture').setAttribute('aria-invalid', 'true');
}

$('replay-fixture').addEventListener('input', () => {
  replaySource = ''; $('replay-fixture').removeAttribute('aria-invalid');
  $('replay-source').textContent = 'Generate a test after editing the scenario.'; replayControls();
});
$('replay-draft').addEventListener('click', () => { void action(async () => {
  showExport(await request(`/api/sessions/${selected}/export`));
}); });
$('replay-export').addEventListener('click', () => { void action(async () => {
  try { showExport(await request(`/api/sessions/${selected}/export`, 'POST', { fixture: readScenario() })); }
  catch (error) { scenarioError(error); throw error; }
}); });
$('replay-run').addEventListener('click', () => { void action(async () => {
  try {
    const result = await request(`/api/sessions/${selected}/replay`, 'POST', { fixture: readScenario() });
    $('replay-result').textContent = `Replay passed: ${result.turns.length} turns matched expected states and outcomes. The active session is unchanged.`;
  } catch (error) { scenarioError(error); throw error; }
}); });
$('replay-download').addEventListener('click', () => {
  if (!replaySource || busy) return;
  const url = URL.createObjectURL(new Blob([replaySource], { type: 'text/javascript' }));
  const link = document.createElement('a');
  link.href = url; link.download = replayFilename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function renderAnalysis(snapshot) {
  const analysis = snapshot.analysis;
  const truncated = renderFlowGraph($('graph'), analysis, snapshot.status === 'expired' ? null : snapshot.state, snapshot.status);
  $('graph-summary').textContent = `${analysis.summary.states} states · ${analysis.summary.transitions} declared transitions`;
  $('graph-note').textContent = `${analysis.coverage === 'partial' ? 'Partial analysis: unknown exits are shown explicitly. ' : ''}Declarations show possible paths; runtime history shows what happened.${truncated ? ' Diagram limited to 60 states and 120 edges; the text view contains all declarations.' : ''}`;
  $('graph-text').replaceChildren(...analysis.nodes.map(node => {
    const row = document.createElement('li');
    const transitions = analysis.edges.filter(edge => edge.from === node.id).map(edge =>
      `${edge.input ?? edge.kind ?? 'next'} → ${edge.terminal ? 'END' : edge.to ?? 'invalid target'}${edge.missingTarget ? ' (missing)' : ''}${edge.navigationConflict ? ' (back takes precedence when history exists)' : ''}`);
    row.textContent = `${node.id}${node.isInitial ? ' (start)' : ''}${node.id === snapshot.state ? ' (current)' : ''}: ${transitions.join('; ') || (node.terminal ? 'END' : 'no declared transitions')}. ${node.dynamic || node.terminal === null ? 'Unknown exits. ' : ''}Reachability: ${node.reachability}. Local keys: ${node.localInputKeys.join(', ') || 'none'}.`;
    return row;
  }));
  $('diagnostic-count').textContent = `${analysis.summary.errors} errors · ${analysis.summary.warnings} warnings`;
  const diagnostics = analysis.diagnostics.length ? analysis.diagnostics :
    [{ severity: 'info', message: 'No structural issues found in declared metadata.' }];
  $('diagnostics').replaceChildren(...diagnostics.map(item => {
    const row = document.createElement('li');
    row.dataset.severity = item.severity;
    const severity = document.createElement('span');
    severity.textContent = item.severity;
    const message = document.createElement('span');
    message.textContent = item.message;
    row.append(severity, message);
    return row;
  }));
}

function render(snapshot) {
  snapshots.set(snapshot.id, snapshot);
  renderSessions();
  renderAnalysis(snapshot);
  renderReplay(snapshot);
  const last = snapshot.history.at(-1);
  $('flow-name').textContent = snapshot.name;
  $('session-status').textContent = `Session ${numbers.get(snapshot.id)} · ${snapshot.status}`;
  $('turn-time').textContent = last ? `${last.durationMs} ms` : '— ms';
  $('screen').textContent = snapshot.response?.replace(/^(CON |END )/, '') ||
    (snapshot.status === 'error' ? 'The turn failed. Check the inspector.' : snapshot.status === 'expired' ? 'Session expired. Reset to start again.' : 'Dial to start.');
  $('current-state').textContent = snapshot.state || (snapshot.status === 'expired' ? 'No active state' : `${snapshot.initialState} (not started)`);
  $('flow-version').textContent = snapshot.definition.flowVersion || 'Unversioned';
  $('flow-source').textContent = snapshot.definition.source === 'sdk' ? 'Fluent SDK' : 'Traditional';
  $('coverage').textContent = snapshot.definition.coverage === 'complete' ? 'Declared metadata' : 'Partial metadata';
  $('back-key').textContent = snapshot.definition.navigation.backKey || 'Disabled';
  const state = snapshot.stateInfo?.definition;
  const transitions = (state?.transitions || []).map(edge => {
    const row = document.createElement('div');
    row.className = 'transition-row';
    const input = document.createElement('span');
    input.textContent = edge.input ?? edge.kind ?? 'next';
    const target = document.createElement('span');
    target.textContent = `→ ${edge.terminal ? 'END' : edge.to || 'unknown'}`;
    row.append(input, target);
    return row;
  });
  const description = document.createElement('p');
  description.className = 'metadata-note';
  description.textContent = state?.dynamic ? 'Dynamic handler: declared transitions are incomplete.' :
    state?.terminal ? 'This state ends the session.' : transitions.length ? 'Declarations describe the flow; turn history shows execution.' : 'No transitions declared.';
  $('transitions').replaceChildren(...transitions, description);
  $('data').textContent = JSON.stringify(snapshot.data.values, null, 2);
  $('hidden-data').textContent = snapshot.data.hiddenFields ?
    `${snapshot.data.hiddenFields} sensitive or undeclared field${snapshot.data.hiddenFields === 1 ? '' : 's'} hidden.` : 'Only small scalar fields declared public appear here.';
  $('state-history').textContent = snapshot.stateHistory.length ? snapshot.stateHistory.join(' → ') : 'No previous states.';
  $('turn-count').textContent = `${snapshot.totalTurns} turn${snapshot.totalTurns === 1 ? '' : 's'}`;
  if (snapshot.history.length) {
    const offset = snapshot.totalTurns - snapshot.history.length;
    $('history').replaceChildren(...snapshot.history.map((event, index) => {
      const row = document.createElement('tr');
      const values = [String(offset + index + 1).padStart(2, '0'),
        `${event.previousState || '—'} → ${event.nextState || 'END'}`, event.outcome.replaceAll('_', ' '), `${event.durationMs} ms`];
      values.forEach((value, column) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (column === 2) { cell.className = 'outcome'; cell.dataset.error = String(event.errorClass !== null); }
        row.append(cell);
      });
      return row;
    }));
  } else {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty';
    cell.textContent = 'Dial to record the first turn.';
    row.append(cell);
    $('history').replaceChildren(row);
  }
  keypad.setSession({ started: snapshot.totalTurns > 0, closed: snapshot.ended || snapshot.status === 'expired' });
  if (snapshot.error) notice(messages[snapshot.error] || messages.TURN_FAILED, 'error');
  else if (snapshot.validationError) notice('Validation failed. Correct your reply to continue.', 'validation');
  else notice(snapshot.status === 'expired' ? 'Session expired. Reset to start again.' :
    snapshot.ended ? 'Session ended. Reset this session or start another.' :
    snapshot.status === 'idle' ? 'Dial to begin. Your session is isolated from the others.' :
      'Reply to continue. Current state and timing update after each turn.');
}

async function action(fn) {
  if (busy) return;
  const trigger = document.activeElement;
  lock(true);
  keypad.setBusy(true);
  try { await fn(); }
  catch (error) { notice(error.message, 'error'); }
  finally {
    lock(false); keypad.setBusy(false);
    if (trigger?.closest('.replay-panel') && $('replay-fixture').getAttribute('aria-invalid') === 'true') {
      $('replay-fixture').focus();
    } else if (document.activeElement === document.body) {
      const target = trigger?.isConnected ? trigger : document.querySelector('.session-tab[aria-pressed="true"]');
      if (target && target !== document.body && !target.disabled) target.focus({ preventScroll: true });
    }
  }
}

const keypad = attachKeypad({ input: $('reply'), send: $('send'), reset: $('reset'),
  keys: document.querySelectorAll('[data-key]'),
  async onSubmit(input) {
    if (!selected) return;
    lock(true);
    try {
      const snapshot = snapshots.get(selected);
      render(await request(`/api/sessions/${selected}/turns`, 'POST', { input: snapshot.totalTurns ? input : '' }));
    } catch (error) { notice(error.message, 'error'); }
    finally { lock(false); }
  },
  async onReset() {
    if (!selected) return;
    lock(true);
    try { render(await request(`/api/sessions/${selected}/reset`, 'POST', {})); }
    catch (error) { notice(error.message, 'error'); }
    finally { lock(false); }
  }
});
keypad.setBusy(true);

async function newSession() {
  const snapshot = await request('/api/sessions', 'POST', { flowId: $('flow').value });
  numbers.set(snapshot.id, nextNumber++);
  selected = snapshot.id;
  render(snapshot);
}

$('new-session').addEventListener('click', () => { void action(newSession); });
$('close-session').addEventListener('click', () => { void action(async () => {
  await request(`/api/sessions/${selected}`, 'DELETE');
  snapshots.delete(selected);
  numbers.delete(selected);
  selected = snapshots.keys().next().value || null;
  if (!selected) await newSession();
  else render(await request(`/api/sessions/${selected}`));
}); });

void action(async () => {
  config = await request('/api/workbench');
  $('flow').replaceChildren(...config.flows.map(flow => {
    const option = document.createElement('option');
    option.value = flow.id;
    option.textContent = flow.name;
    return option;
  }));
  for (const session of config.sessions) {
    numbers.set(session.id, nextNumber++);
    snapshots.set(session.id, await request(`/api/sessions/${session.id}`));
  }
  if (snapshots.size) { selected = snapshots.keys().next().value; render(snapshots.get(selected)); }
  else await newSession();
});
