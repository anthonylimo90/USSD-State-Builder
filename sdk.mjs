/**
 * USSD State Builder SDK - ESM Entry Point
 *
 * Enables: import { createApp } from 'ussd-state-builder/sdk';
 */
import sdk from './sdk.js';

export const createApp = sdk.createApp;
export const AppBuilder = sdk.AppBuilder;
export const StateBuilder = sdk.StateBuilder;
export const RouteBuilder = sdk.RouteBuilder;

export default sdk;
