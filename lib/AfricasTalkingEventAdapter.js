const { createHash } = require('node:crypto');
const { AfricasTalkingAdapter, ProviderRequestError, parseFormRequest, hasControl, sessionKeyFor } = require('./AfricasTalkingAdapter');

class AfricasTalkingEventAdapter {
  constructor(options) {
    const adapter = new AfricasTalkingAdapter(options);
    Object.assign(this, { applicationId: adapter.applicationId, serviceCode: adapter.serviceCode,
      phonePattern: adapter.phonePattern, maxBodyBytes: adapter.maxBodyBytes,
      maxTranscriptLength: adapter.maxTranscriptLength, maxResponseBytes: adapter.maxResponseBytes,
      maxFieldLength: adapter.maxFieldLength });
  }
  normalize(request) {
    const fields = parseFormRequest(request, this.maxBodyBytes);
    const required = ['date', 'sessionId', 'serviceCode', 'networkCode', 'phoneNumber', 'status', 'cost',
      'durationInMillis', 'hopsCount', 'hopsMetadata', 'input', 'lastAppResponse'];
    if (required.some(key => typeof fields[key] !== 'string') ||
        required.some(key => Buffer.byteLength(fields[key]) > (key === 'input' ? this.maxTranscriptLength :
          key === 'lastAppResponse' ? this.maxResponseBytes : key === 'hopsMetadata' ? 4096 : this.maxFieldLength)) ||
        required.some(key => hasControl(fields[key])) ||
        (fields.errorMessage !== undefined && (typeof fields.errorMessage !== 'string' ||
          Buffer.byteLength(fields.errorMessage) > 1024 || hasControl(fields.errorMessage)))) {
      throw new ProviderRequestError('INVALID_EVENT_FIELDS');
    }
    if (!fields.sessionId || !fields.networkCode || !fields.phoneNumber ||
        [fields.sessionId, fields.networkCode, fields.phoneNumber, fields.serviceCode].some(value => /\s/.test(value))) {
      throw new ProviderRequestError('INVALID_EVENT_IDENTITY');
    }
    this.phonePattern.lastIndex = 0;
    if (!this.phonePattern.test(fields.phoneNumber)) throw new ProviderRequestError('INVALID_CALLER');
    if (fields.serviceCode !== this.serviceCode) throw new ProviderRequestError('SERVICE_NOT_ALLOWED', 403);
    if (!['Incomplete', 'Success', 'Failed'].includes(fields.status)) throw new ProviderRequestError('INVALID_EVENT_STATUS');
    if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(fields.date)) throw new ProviderRequestError('INVALID_EVENT_DATE');
    const occurredAt = Date.parse(`${fields.date.replace(' ', 'T')}Z`);
    if (!Number.isFinite(occurredAt) || new Date(occurredAt).toISOString().slice(0, 19).replace('T', ' ') !== fields.date) {
      throw new ProviderRequestError('INVALID_EVENT_DATE');
    }
    for (const key of ['durationInMillis', 'hopsCount']) {
      if (!/^\d+$/.test(fields[key]) || !Number.isSafeInteger(Number(fields[key]))) throw new ProviderRequestError('INVALID_EVENT_NUMBER');
    }
    if (fields.input.length > this.maxTranscriptLength) throw new ProviderRequestError('INVALID_EVENT_INPUT');
    const binding = Object.freeze({ provider: 'africas-talking', applicationId: this.applicationId,
      sessionId: fields.sessionId, serviceCode: fields.serviceCode, phoneNumber: fields.phoneNumber,
      networkCode: fields.networkCode });
    const eventFields = Object.fromEntries(required.map(key => [key, fields[key]]));
    if (fields.errorMessage !== undefined) eventFields.errorMessage = fields.errorMessage;
    const fingerprint = createHash('sha256').update(JSON.stringify(eventFields)).digest('hex');
    return Object.freeze({ sessionKey: sessionKeyFor(this.applicationId, this.serviceCode, fields.sessionId),
      binding, occurredAt, status: fields.status, fingerprint, fields: Object.freeze(eventFields) });
  }
}
module.exports = { AfricasTalkingEventAdapter };
