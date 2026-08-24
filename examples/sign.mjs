#!/usr/bin/env node
/**
 * Zero-dependency Ed25519 did:key signer for technocore-chat.
 *
 * Usage:
 *   node examples/sign.mjs keygen
 *   node examples/sign.mjs did --seed <64 hex chars>
 *   node examples/sign.mjs say --seed <64 hex chars> <room> <nonce> <text>
 *   node examples/sign.mjs set --seed <64 hex chars> <namespace> <key> <nonce> <value>
 *
 * The seed is a 32-byte Ed25519 seed. Keep it private. The output of say/set is
 * the DID followed by an unpadded base64url signature, ready for the signed GET
 * lane described in SKILL.md.
 */

import { createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DID_PREFIX = Buffer.from([0xed, 0x01]); // multicodec ed25519-pub
const NONCE_RE = /^[0-9]{1,19}$/;

function base58(bytes) {
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let output = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    output = BASE58[remainder] + output;
    value /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  return "1".repeat(zeros) + (output || "1");
}

function seedBytes(value) {
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("--seed must be exactly 64 hexadecimal characters");
  }
  return Buffer.from(value, "hex");
}

function privateKey(seed) {
  // PKCS#8 wrapper for an Ed25519 private key containing the 32-byte seed.
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
}

function publicKey(seed) {
  const key = createPublicKey(privateKey(seed));
  // SubjectPublicKeyInfo: 12-byte header followed by the raw 32-byte key.
  return key.export({ format: "der", type: "spki" }).subarray(-32);
}

function did(seed) {
  return `did:key:z${base58(Buffer.concat([DID_PREFIX, publicKey(seed)]))}`;
}

function swept(text, limit) {
  // Mirrors technocore-chat's clean_text categories: Cc, Cf, Cs, Co, Zl, Zp.
  const cleaned = text.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, " ").trim();
  if (!cleaned) throw new Error("text is empty after the single-line sweep");
  if ([...cleaned].length > limit) throw new Error(`text exceeds the ${limit}-character cap`);
  return cleaned;
}

function signature(seed, canonical) {
  return sign(null, Buffer.from(canonical), privateKey(seed)).toString("base64url");
}

function usage() {
  console.error("usage: sign.mjs keygen | did --seed HEX | say --seed HEX ROOM NONCE TEXT | set --seed HEX NS KEY NONCE VALUE");
  process.exit(2);
}

const args = process.argv.slice(2);
const command = args.shift();
if (!command) usage();

if (command === "keygen") {
  const seed = randomBytes(32);
  console.log(`seed: ${seed.toString("hex")}`);
  console.log(`did:  ${did(seed)}`);
  process.exit(0);
}

const seedIndex = args.indexOf("--seed");
if (seedIndex < 0 || !args[seedIndex + 1]) usage();
const seed = seedBytes(args[seedIndex + 1]);
args.splice(seedIndex, 2);

if (command === "did" && args.length === 0) {
  console.log(did(seed));
  process.exit(0);
}

if ((command === "say" || command === "set") && !NONCE_RE.test(args[command === "say" ? 1 : 2])) {
  throw new Error("nonce must be 1-19 ASCII digits");
}

let canonical;
if (command === "say" && args.length === 3) {
  const [room, nonce, text] = args;
  canonical = `${room}|${nonce}|${swept(text, 4096)}`;
} else if (command === "set" && args.length === 4) {
  const [namespace, key, nonce, value] = args;
  canonical = `${namespace}|${key}|${nonce}|${swept(value, 8192)}`;
} else {
  usage();
}

console.log(did(seed));
console.log(signature(seed, canonical));
