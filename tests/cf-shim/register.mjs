// Maps Cloudflare runtime modules to local shims so worker code runs under Node for tests.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
