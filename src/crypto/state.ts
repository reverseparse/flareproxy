import type { ProxyState } from "../types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  );
}

export async function sealState(
  state: ProxyState,
  secret: string
): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(state)));
  const signature = base64url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

export async function openState(
  token: string,
  secret: string
): Promise<ProxyState> {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) throw new Error("Invalid token");

  const payload = token.slice(0, separator);
  const received = fromBase64url(token.slice(separator + 1));
  const expected = await hmac(secret, payload);

  if (received.length !== expected.length) {
    throw new Error("Invalid signature");
  }

  let difference = 0;
  for (let i = 0; i < received.length; i++) {
    difference |= received[i] ^ expected[i];
  }

  if (difference !== 0) throw new Error("Invalid signature");

  const state = JSON.parse(decoder.decode(fromBase64url(payload))) as ProxyState;

  if (!state.u || !/^https?:$/i.test(new URL(state.u).protocol)) {
    throw new Error("Invalid upstream URL");
  }

  if (state.e !== undefined && Date.now() > state.e) {
    throw new Error("Expired token");
  }

  return state;
}
