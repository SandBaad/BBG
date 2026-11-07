import net from 'node:net';
import { Readable, Writable } from 'node:stream';
export function connect({ hostname, port }) {
  const sock = net.connect({ host: hostname, port });
  const opened = new Promise((res, rej) => { sock.once('connect', () => res({})); sock.once('error', rej); });
  opened.catch(() => {});
  return {
    opened,
    readable: Readable.toWeb(sock),
    writable: Writable.toWeb(sock),
    close() { sock.destroy(); },
  };
}
