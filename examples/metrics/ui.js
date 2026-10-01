const get = id => document.getElementById(id);
const label = value => value ?? 'Unknown';
const percent = rate => rate.value === null ? '—' : `${(rate.value * 100).toFixed(1)}%`;
const pair = rate => `${rate.numerator} / ${rate.denominator}`;
const cell = (row, text) => { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; };
function rateCell(row, rate) {
  const td = cell(row, pair(rate)); const detail = document.createElement('span');
  detail.className = 'muted'; detail.textContent = percent(rate); td.append(detail);
}
let report, generation = 0, evidenceGeneration = 0, evidenceTrigger, displayedScenario = 'baseline';
function stat(parent, title, value, detail) {
  const node = document.createElement('div'); node.className = 'stat';
  for (const [className, text] of [['label', title], ['value', value], ['detail', detail]]) { const item = document.createElement('div'); item.className = className; item.textContent = text; node.append(item); }
  parent.append(node);
}
function closeEvidence(restoreFocus = true) { evidenceGeneration++; get('evidence-panel').hidden = true; get('evidence').textContent = ''; if (restoreFocus) evidenceTrigger?.focus(); }
function renderStates() {
  const version = get('version').value;
  const body = get('states'); body.replaceChildren();
  for (const state of report.states.filter(value => version === 'all' || JSON.stringify(value.flowVersion) === version)) {
    const row = document.createElement('tr');
    cell(row, `${label(state.flowVersion)} / ${label(state.state)}`); cell(row, state.sessionsReached);
    rateCell(row, { numerator: state.reachedSessionOutcomes.completed, denominator: state.sessionsReached, value: state.sessionsReached ? state.reachedSessionOutcomes.completed / state.sessionsReached : null });
    rateCell(row, state.observedDropOffRate);
    rateCell(row, state.inferredDropOffRate);
    cell(row, state.exits.unknown); cell(row, `${state.turns.validationRetries} / ${state.turns.outcomes.validation_error}`);
    cell(row, state.turns.backendErrors);
    const duration = cell(row, ['p50', 'p95', 'p99'].map(name => state.latency[name].value ?? '—').join(' / '));
    const count = document.createElement('span'); count.className = 'muted'; count.textContent = `${state.latency.count} turn sample${state.latency.count === 1 ? '' : 's'}`; duration.append(count);
    const button = document.createElement('button'); button.textContent = 'Inspect'; button.setAttribute('aria-label', `Inspect evidence for ${label(state.flowVersion)} ${label(state.state)}`);
    button.addEventListener('click', async () => {
      evidenceTrigger = button; const current = generation, evidenceRequest = ++evidenceGeneration;
      const query = new URLSearchParams({ scenario: displayedScenario, flowVersion: state.flowVersion ?? '__unknown__', state: state.state ?? '__unknown__' });
      get('status').textContent = 'Loading redacted evidence…';
      try {
        const response = await fetch(`/api/evidence?${query}`); if (!response.ok) throw new Error('Evidence unavailable');
        const value = await response.json(); if (current !== generation || evidenceRequest !== evidenceGeneration) return;
        get('evidence-scope').textContent = `${label(state.flowVersion)} / ${label(state.state)} · ${value.total} structural events${value.truncated ? ' · showing the first 100' : ''}`;
        get('evidence').textContent = JSON.stringify(value.events, null, 2); get('evidence-panel').hidden = false; get('evidence').focus();
        get('status').textContent = 'Redacted evidence loaded.';
      } catch { if (current === generation && evidenceRequest === evidenceGeneration) get('status').textContent = 'Evidence could not be loaded. Try again.'; }
    });
    cell(row, '').append(button); body.append(row);
  }
}
async function load() {
  const current = ++generation;
  evidenceGeneration++; get('version').disabled = true; for (const button of get('states').querySelectorAll('button')) button.disabled = true; get('status').textContent = 'Loading cohort…'; get('evidence-panel').hidden = true; get('evidence').textContent = '';
  const query = new URLSearchParams({ scenario: get('scenario').value });
  try {
    const response = await fetch(`/api/report?${query}`); if (!response.ok) throw new Error('Report unavailable');
    const next = await response.json(); if (current !== generation) return; report = next; displayedScenario = query.get('scenario'); evidenceGeneration++;
    get('json-link').href = `/api/report?${query}`; get('prom-link').href = `/metrics?${query}`;
    get('scope').textContent = `All supplied starts through ${report.asOf} · ${report.inactivityMs / 1000}s inactivity inference · synthetic only`;
    const totals = get('totals'); totals.replaceChildren(); const summary = report.summary;
    stat(totals, 'Started sessions', summary.sessions.total, 'Includes open and unknown');
    stat(totals, 'Completed', percent(summary.sessions.completionRate), `${pair(summary.sessions.completionRate)} sessions`);
    stat(totals, 'Inferred abandoned', summary.sessions.outcomes.abandoned, 'Policy estimate');
    stat(totals, 'Unknown closures', summary.sessions.outcomes.unknown, 'Reason not established');
    stat(totals, 'Validation retries', summary.turns.validationRetries, `${summary.turns.outcomes.validation_error} validation failure${summary.turns.outcomes.validation_error === 1 ? '' : 's'}`);
    stat(totals, 'Request attempts', summary.requests.total, `${summary.turns.total} logical turns`);
    const flows = get('flows'); flows.replaceChildren(); get('version').replaceChildren();
    const all = document.createElement('option'); all.value = 'all'; all.textContent = 'All versions'; get('version').append(all);
    for (const flow of report.flows) {
      const row = document.createElement('tr');
      for (const value of [label(flow.flowVersion), flow.sessions.total, `${pair(flow.sessions.completionRate)} · ${percent(flow.sessions.completionRate)}`,
        ...['cancelled', 'expired', 'abandoned', 'unknown', 'open'].map(name => flow.sessions.outcomes[name]), flow.turns.total]) cell(row, value);
      flows.append(row); const option = document.createElement('option'); option.value = JSON.stringify(flow.flowVersion); option.textContent = label(flow.flowVersion); get('version').append(option);
    }
    renderStates(); const latency = get('latency'); latency.replaceChildren();
    for (const [name, title] of [['count', 'Turn samples'], ['p50', 'p50 · ms'], ['p95', 'p95 · ms'], ['p99', 'p99 · ms']]) {
      const div = document.createElement('div'), small = document.createElement('small'), strong = document.createElement('strong');
      small.textContent = title; strong.textContent = name === 'count' ? report.latency.count : report.latency[name].value ?? '—'; div.append(small, strong); latency.append(div);
    }
    const coverage = summary.evidence;
    get('coverage').textContent = `${coverage.uniqueEvents} included envelopes · ${coverage.duplicateEvents} duplicate deliveries · ${coverage.duplicateFacts} repeated logical facts · ${coverage.orphanEvents} events missing a session start · ${coverage.futureEvents} future events excluded.`;
    get('status').textContent = 'Synthetic cohort loaded.';
  } catch { if (current === generation) get('status').textContent = 'The report could not be loaded. Change the scenario to retry.'; }
  finally { if (current === generation) { get('version').disabled = false; for (const button of get('states').querySelectorAll('button')) button.disabled = false; } }
}
get('scenario').addEventListener('change', load);
get('version').addEventListener('change', () => { closeEvidence(false); renderStates(); });
get('close-evidence').addEventListener('click', () => closeEvidence());
load();
