import Docker from "dockerode";

const clients = new Map<string, Docker>();

/**
 * A cached dockerode client.
 * No host: DOCKER_HOST or the platform's default socket / named pipe.
 * Otherwise "unix:///path", "npipe:////./pipe/name" or "tcp://host:port".
 */
export function dockerClient(host?: string): Docker {
  const key = host ?? "";
  let c = clients.get(key);
  if (!c) {
    if (!host) c = new Docker();
    else if (host.startsWith("unix://")) c = new Docker({ socketPath: host.slice("unix://".length) });
    else if (host.startsWith("npipe://")) c = new Docker({ socketPath: host.slice("npipe://".length) });
    else {
      const u = new URL(host.replace(/^tcp:/, "http:"));
      c = new Docker({ host: u.hostname, port: Number(u.port || 2375), protocol: "http" });
    }
    clients.set(key, c);
  }
  return c;
}
