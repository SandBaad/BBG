import worker from '../worker/panel.js';

export const onRequest = (context) => worker.fetch(context.request, context.env, context);

