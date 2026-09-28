const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');

class ProviderRequestError extends Error {
  constructor(code, status = 400) {
    super(code);
    if (!Number.isInteger(status) || status < 400 || status > 599) throw new TypeError('Provider error status must be 400–599');
    this.name = 'ProviderRequestError';
    this.code = code;
    this.status = status;
  }
}

function normalizeUssdInput(text, mode) {
  if (typeof text !== 'string') throw new TypeError('USSD input must be a string');
  if (mode === 'incremental') return { inputMode: mode, input: text, transcript: null, position: null };
  if (mode !== 'cumulative') throw new TypeError('Input mode must be explicit: cumulative or incremental');
  const segments = text === '' ? [] : text.split('*');
  return { inputMode: mode, input: segments.at(-1) || '', transcript: text, position: segments.length };
}

function hasControl(text) {
  return [...text].some(character => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && code !== 9 && code !== 10);
  });
}

// Parse raw wire bytes rather than accepting a framework's lossy duplicate-key coercion.
function parseForm(body, maxBytes) {
  if (typeof body !== 'string' && !Buffer.isBuffer(body)) throw new ProviderRequestError('INVALID_BODY');
  if (Buffer.byteLength(body) > maxBytes) throw new ProviderRequestError('BODY_TOO_LARGE', 413);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.isBuffer(body) ? body : Buffer.from(body)); }
  catch { throw new ProviderRequestError('INVALID_ENCODING'); }
  const pairs = text.split('&');
  if (!text || pairs.length > 32) throw new ProviderRequestError('INVALID_FORM');
  const fields = Object.create(null);
  try {
    for (const pair of pairs) {
      const index = pair.indexOf('=');
      if (index < 0) throw new Error('Invalid pair');
      const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
      const key = decode(pair.slice(0, index));
      if (!key || Object.hasOwn(fields, key)) throw new Error('Duplicate key');
      fields[key] = decode(pair.slice(index + 1));
    }
  } catch { throw new ProviderRequestError('INVALID_FORM'); }
  return fields;
}

class AfricasTalkingAdapter {
  constructor(options) {
    if (!options || typeof options.applicationId !== 'string' || !options.applicationId.trim() ||
        options.applicationId.length > 128 || typeof options.serviceCode !== 'string' ||
        !options.serviceCode.trim() || options.serviceCode.length > 128) {
      throw new TypeError('An applicationId and serviceCode are required');
    }
    this.applicationId = options.applicationId;
    this.serviceCode = options.serviceCode;
    this.phonePattern = options.phonePattern || /^\+?[1-9]\d{5,14}$/;
    if (!(this.phonePattern instanceof RegExp)) throw new TypeError('phonePattern must be a RegExp');
    // These are local resource bounds, not operator-specific character budgets.
    for (const [key, fallback] of Object.entries({ maxBodyBytes: 16384, maxTranscriptLength: 4096,
      maxInputLength: 160, maxResponseBytes: 16384, maxFieldLength: 128 })) {
      const value = options[key] ?? fallback;
      if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${key} must be a positive integer`);
      this[key] = value;
    }
  }

  normalize(request) {
    if (!request || request.method !== 'POST') throw new ProviderRequestError('METHOD_NOT_ALLOWED', 405);
    if (typeof request.contentType !== 'string' ||
        request.contentType.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
      throw new ProviderRequestError('UNSUPPORTED_MEDIA_TYPE', 415);
    }
    const charsets = request.contentType.split(';').slice(1).filter(part => /^\s*charset\s*=/i.test(part));
    if (charsets.some(part => !/^\s*charset\s*=\s*(utf-8|"utf-8")\s*$/i.test(part))) {
      throw new ProviderRequestError('UNSUPPORTED_ENCODING', 415);
    }
    const fields = parseForm(request.body, this.maxBodyBytes);
    for (const key of ['sessionId', 'phoneNumber', 'networkCode', 'serviceCode', 'text']) {
      if (typeof fields[key] !== 'string' || (key !== 'text' && !fields[key]) ||
          (key !== 'text' && (fields[key].length > this.maxFieldLength || (hasControl(fields[key]) || /\s/.test(fields[key]))))) {
        throw new ProviderRequestError('INVALID_FIELDS');
      }
    }
    this.phonePattern.lastIndex = 0;
    if (!this.phonePattern.test(fields.phoneNumber)) throw new ProviderRequestError('INVALID_CALLER');
    if (fields.serviceCode !== this.serviceCode) throw new ProviderRequestError('SERVICE_NOT_ALLOWED', 403);
    if (fields.text.length > this.maxTranscriptLength || hasControl(fields.text)) {
      throw new ProviderRequestError('INVALID_TRANSCRIPT');
    }
    const input = normalizeUssdInput(fields.text, 'cumulative');
    if (input.input.length > this.maxInputLength) throw new ProviderRequestError('INPUT_TOO_LONG');
    const sessionKey = 'at:' + createHash('sha256').update(JSON.stringify([
      1, 'africas-talking', this.applicationId, this.serviceCode, fields.sessionId
    ])).digest('hex');
    return Object.freeze({ provider: 'africas-talking', applicationId: this.applicationId,
      sessionId: fields.sessionId, serviceCode: fields.serviceCode, phoneNumber: fields.phoneNumber,
      networkCode: fields.networkCode, sessionKey, ...input });
  }

  bindSession(turn, existing) {
    const binding = { provider: turn.provider, applicationId: turn.applicationId, sessionId: turn.sessionId,
      serviceCode: turn.serviceCode, phoneNumber: turn.phoneNumber, networkCode: turn.networkCode };
    if (turn.provider !== 'africas-talking' || turn.applicationId !== this.applicationId || turn.serviceCode !== this.serviceCode) {
      throw new ProviderRequestError('SCOPE_CONFLICT', 409);
    }
    if (existing && Object.keys(binding).some(key => existing[key] !== binding[key])) {
      throw new ProviderRequestError('SESSION_BINDING_CONFLICT', 409);
    }
    return Object.freeze(binding);
  }

  compareTranscript(turn, previous) {
    if (turn.inputMode !== 'cumulative' || typeof turn.transcript !== 'string') throw new TypeError('Expected a cumulative turn');
    if (previous === undefined || previous === null) return turn.position === 0 ? 'initial' : 'missing_initial';
    if (typeof previous !== 'string') throw new TypeError('Previous transcript must be a string');
    if (previous === turn.transcript) return 'repeat';
    const before = previous === '' ? [] : previous.split('*');
    const after = turn.transcript === '' ? [] : turn.transcript.split('*');
    const shorter = before.length < after.length ? before : after;
    const longer = before.length < after.length ? after : before;
    if (!shorter.every((value, index) => value === longer[index])) return 'conflict';
    if (after.length < before.length) return 'stale';
    if (after.length === before.length) return 'conflict';
    return after.length === before.length + 1 ? 'next' : 'gap';
  }

  formatResponse(response, options = {}) {
    if (typeof response !== 'string' || !/^(CON|END) .+/.test(response) || !response.slice(4).trim() ||
        hasControl(response) || Buffer.byteLength(response) > this.maxResponseBytes) {
      throw new TypeError('Invalid or oversized USSD response');
    }
    const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
    if (options.hopMetadata !== undefined) {
      const label = options.hopMetadata;
      if (typeof label !== 'string' || label.length > 99 || /[^\x20-\x7e]|\|/.test(label)) {
        throw new TypeError('Hop metadata must be at most 99 printable ASCII characters without |');
      }
      headers['at-ussd-hop-metadata'] = label;
    }
    return { status: 200, headers, body: response };
  }

  errorResponse(error) {
    const status = error instanceof ProviderRequestError ? error.status : 500;
    const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
    if (status === 405) headers.Allow = 'POST';
    return { status, headers, body: status >= 500 ? 'END Service unavailable. Please try again.' : 'END Invalid request.' };
  }

  async handle(request, processTurn) {
    try {
      const turn = this.normalize(request);
      const result = await processTurn(turn);
      return typeof result === 'string' ? this.formatResponse(result) : this.formatResponse(result.response, result);
    } catch (error) { return this.errorResponse(error); }
  }
}

module.exports = { AfricasTalkingAdapter, ProviderRequestError, normalizeUssdInput };
