/** Shared Mavuno/workbench keypad. Transport and session selection stay with the host. */
export function attachKeypad({ input, send, reset, keys, onSubmit, onReset }) {
  let busy = false;
  let ended = false;
  const listeners = [];
  const listen = (element, event, fn) => {
    element.addEventListener(event, fn);
    listeners.push(() => element.removeEventListener(event, fn));
  };
  const update = () => {
    send.disabled = busy || ended;
    reset.disabled = busy;
    input.disabled = busy || ended;
    for (const key of keys) key.disabled = busy || ended;
  };
  const submit = async event => {
    event?.preventDefault();
    if (busy || ended) return;
    busy = true;
    update();
    try { await onSubmit(input.value); }
    finally {
      busy = false;
      input.value = '';
      update();
      if (!ended) input.focus();
    }
  };
  listen(send, 'click', submit);
  listen(input, 'keydown', event => { if (event.key === 'Enter') void submit(event); });
  listen(reset, 'click', async () => {
    if (busy) return;
    busy = true;
    update();
    try { await onReset(); input.value = ''; }
    finally { busy = false; update(); if (!ended) input.focus(); }
  });
  for (const key of keys) listen(key, 'click', () => {
    if (busy || ended) return;
    input.value = key.dataset.key === '' ? '' : (input.value + key.dataset.key).slice(0, 160);
    input.focus();
  });
  update();
  return {
    setSession({ started = false, closed = false } = {}) {
      ended = closed;
      send.textContent = closed ? 'Session ended' : started ? 'Send reply' : 'Dial';
      update();
    },
    setBusy(value) { busy = value; update(); },
    destroy() { listeners.forEach(remove => remove()); }
  };
}
