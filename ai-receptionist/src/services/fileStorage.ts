// File Storage batch: object storage behind ONE small interface.
//
// Three modes, decided once from env (see env.ts):
//   "r2"    — all four R2_* vars present: Cloudflare R2 via the official AWS SDK
//             v3 S3 client (R2 is S3-compatible). Bucket is PRIVATE; bytes only
//             ever reach a browser through the authenticated /api/files route.
//   "local" — vars absent outside production: filesystem under gitignored
//             .data/files/, SAME code path minus the S3 transport, so dev and
//             every self-test exercise the real service/endpoint/sweep offline.
//   "off"   — vars absent IN production: the do-nothing path. Callers must
//             check storageMode() first; uploads keep the embedded-base64
//             behavior byte-for-byte and the migration sweep never runs.
//
// Honest gap (stated in the batch proposal): the R2Client class itself is only
// truly exercised in production — fallback proves everything except the S3
// transport.

import { createHash } from "crypto";
import { promises as fs } from "fs";
import { dirname, join, resolve } from "path";
import { env, isProduction } from "../config/env";

export type StorageMode = "r2" | "local" | "off";

export function storageMode(): StorageMode {
  const configured = !!(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);
  if (configured) return "r2";
  return isProduction() ? "off" : "local";
}

// ---- Size caps (approved Table e). The raised caps apply only when storage is
// on; with mode "off" the SPA never sees the flag and keeps today's 1/2 MB caps.
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_FIELD_BYTES = 15 * 1024 * 1024;
export const IMAGE_CAP_COPY = "Images can be up to 8 MB.";
export const FILE_CAP_COPY = "Files can be up to 15 MB.";

// ---- Reference format: "clarityfile:<id>" (approved Table c). Self-describing,
// greppable, impossible to confuse with a data URL.
export const FILE_REF_PREFIX = "clarityfile:";
export function makeFileRef(id: string): string { return FILE_REF_PREFIX + id; }
export function parseFileRef(v: unknown): string | null {
  if (typeof v !== "string" || !v.startsWith(FILE_REF_PREFIX)) return null;
  const id = v.slice(FILE_REF_PREFIX.length).trim();
  return /^[a-z0-9]+$/i.test(id) ? id : null;
}
/** True for the data-URL shape the pre-batch app embedded everywhere. */
export function isDataUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("data:");
}

export function sha256Hex(buf: Buffer): string { return createHash("sha256").update(buf).digest("hex"); }

/** The storage path for a file's bytes — tenant-prefixed for bucket hygiene. */
export function storageKeyFor(tenantId: string, fileId: string): string {
  return `tenants/${tenantId}/files/${fileId}`;
}

// ============================================================================
// The one interface both transports implement.
export interface StorageClient {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// ---- Local filesystem fallback ---------------------------------------------
// .data/ is gitignored; keys map 1:1 to paths (keys are app-generated, never
// user input, so no traversal surface — asserted below anyway).
const LOCAL_ROOT = resolve(process.cwd(), ".data", "files");
function localPath(key: string): string {
  const p = resolve(LOCAL_ROOT, key);
  if (!p.startsWith(LOCAL_ROOT)) throw new Error("Bad storage key"); // belt + braces
  return p;
}
const localClient: StorageClient = {
  async put(key, bytes) {
    const p = localPath(key);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, bytes);
  },
  async get(key) {
    try { return await fs.readFile(localPath(key)); } catch { return null; }
  },
  async delete(key) {
    try { await fs.unlink(localPath(key)); } catch { /* already gone = fine */ }
  },
  async exists(key) {
    try { await fs.access(localPath(key)); return true; } catch { return false; }
  },
};

// ---- Cloudflare R2 (S3-compatible) ------------------------------------------
// Lazy require + lazy client: the SDK is only loaded when mode is "r2", so dev
// and tests never touch it and local mode has zero SDK surface.
let _r2: StorageClient | null = null;
function r2Client(): StorageClient {
  if (_r2) return _r2;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  const Bucket = env.R2_BUCKET;
  _r2 = {
    async put(key, bytes, mime) {
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: mime }));
    },
    async get(key) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
        const chunks: Buffer[] = [];
        for await (const c of out.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
        return Buffer.concat(chunks);
      } catch (e: any) {
        if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return null;
        throw e;
      }
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async exists(key) {
      try { await s3.send(new HeadObjectCommand({ Bucket, Key: key })); return true; }
      catch (e: any) {
        if (e && (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404)) return false;
        throw e;
      }
    },
  };
  return _r2;
}

/** The active transport for the current mode. Throws in mode "off" — callers
 *  gate on storageMode() first (the do-nothing path never reaches here). */
export function storage(): StorageClient {
  const mode = storageMode();
  if (mode === "r2") return r2Client();
  if (mode === "local") return localClient;
  throw new Error("File storage is not configured");
}
