const { ProviderRequestError } = require('./AfricasTalkingAdapter');
class SessionEventGateway {
  constructor({ adapter, store }) {
    if (!adapter?.normalize || !store?.accept || !store?.read) throw new TypeError('An event adapter and durable event store are required');
    this.adapter = adapter;
    this.store = store;
  }
  async handle(request) {
    try {
      const event = this.adapter.normalize(request);
      const result = await this.store.accept(event);
      return { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        body: 'OK', classification: result.classification };
    } catch (error) {
      return { status: error instanceof ProviderRequestError ? error.status : 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'Unavailable' };
    }
  }
}
module.exports = { SessionEventGateway };
