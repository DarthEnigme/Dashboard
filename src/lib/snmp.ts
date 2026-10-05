import snmp from "net-snmp";

export interface SnmpTarget {
  host: string;
  port?: number;
  community?: string;
  version?: "1" | "2c";
  timeoutMs?: number;
}

export type SnmpValue = number | bigint | string | null;

export interface Varbind {
  oid: string;
  value: SnmpValue;
}

function session(t: SnmpTarget) {
  return snmp.createSession(t.host, t.community ?? "public", {
    port: t.port ?? 161,
    version: t.version === "1" ? snmp.Version1 : snmp.Version2c,
    timeout: t.timeoutMs ?? 3000,
    retries: 1,
  });
}

/** OctetStrings become text when printable, otherwise hex; Counter64 (a Buffer) becomes a bigint. */
export function decodeValue(type: number, value: unknown): SnmpValue {
  if (value === null || value === undefined) return null;
  if (type === snmp.ObjectType.Counter64 && Buffer.isBuffer(value)) {
    return value.length ? BigInt(`0x${value.toString("hex")}`) : 0n;
  }
  if (Buffer.isBuffer(value)) {
    const text = value.toString("utf8");
    return /^[\x20-\x7e\t\r\n]*$/.test(text) ? text.replace(/\0+$/, "") : value.toString("hex");
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") return value;
  return String(value);
}

const isError = (vb: snmp.Varbind) => snmp.isVarbindError(vb);

/** GET a few OIDs; missing ones (noSuchObject…) come back as null. */
export function snmpGet(t: SnmpTarget, oids: string[]): Promise<Varbind[]> {
  return new Promise((resolve, reject) => {
    const s = session(t);
    s.on("error", () => {});
    s.get(oids, (err: Error | null, vbs?: snmp.Varbind[]) => {
      s.close();
      if (err) return reject(err);
      resolve((vbs ?? []).map((vb) => ({ oid: vb.oid, value: isError(vb) ? null : decodeValue(vb.type ?? 0, vb.value) })));
    });
  });
}

/**
 * Walk a subtree (GETBULK on v2c), e.g. a table column. Stops at `max` rows, at the end of the
 * subtree, at the first error varbind (endOfMibView…), and in any case after a deadline: some
 * agents answer past the end of their MIB forever.
 */
export function snmpWalk(t: SnmpTarget, oid: string, max = 500): Promise<Varbind[]> {
  return new Promise((resolve, reject) => {
    const s = session(t);
    s.on("error", () => {});
    const out: Varbind[] = [];
    const prefix = `${oid.replace(/^\./, "")}.`;
    let settled = false;
    const finish = (err?: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      s.close();
      if (err && !out.length) reject(err);
      else resolve(out);
    };
    const deadline = setTimeout(() => finish(), (t.timeoutMs ?? 3000) * 3);
    s.subtree(
      oid,
      20,
      (vbs: snmp.Varbind[]) => {
        for (const vb of vbs) {
          if (isError(vb) || !vb.oid.startsWith(prefix) || out.length >= max) {
            finish();
            return true; // stop the walk
          }
          out.push({ oid: vb.oid, value: decodeValue(vb.type ?? 0, vb.value) });
        }
        return false;
      },
      (err: Error | null) => finish(err),
    );
  });
}

/** Last OID component(s) after a table column prefix: "1.3.6.1.2.1.2.2.1.2.7" under "…2.1.2" → "7". */
export const indexOf = (oid: string, column: string) => oid.slice(column.length + 1);

export const num = (v: SnmpValue): number => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? Number.NaN));
