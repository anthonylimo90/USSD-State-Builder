/**
 * USSD State Builder SDK
 *
 * Fluent/chainable builder API for defining USSD applications.
 * Compiles to standard USSDStateMachine configuration via build().
 *
 * @module ussd-state-builder/sdk
 */
const AppBuilder = require('./AppBuilder');
const StateBuilder = require('./StateBuilder');
const RouteBuilder = require('./RouteBuilder');

/**
 * Create a new USSD application builder
 * @returns {AppBuilder} New AppBuilder instance
 */
function createApp() {
  return new AppBuilder();
}

module.exports = {
  createApp,
  AppBuilder,
  StateBuilder,
  RouteBuilder
};
