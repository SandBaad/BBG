export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:sockets') return { url: new URL('./sockets.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier === 'cloudflare:workers') return { url: new URL('./workers.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
