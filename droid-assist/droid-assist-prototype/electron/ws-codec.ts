import { createHash } from 'node:crypto';

/** RFC 6455 key suffix of the handshake accept hash. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODES = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

/** The Sec-WebSocket-Accept value answering a client's Sec-WebSocket-Key. */
export function acceptKey(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** The HTTP 101 response that completes a WebSocket handshake. */
export function handshakeResponse(key: string): string {
  return ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(key)}`, '', ''].join('\r\n');
}

/** One decoded frame. */
export interface WsFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

/** Encodes one unmasked (server → client) frame, or a masked one when `mask` is given (client → server, tests). */
export function encodeFrame(opcode: number, payload: Buffer, mask?: Buffer): Buffer {
  const len = payload.length;
  const lenBytes = len < 126 ? 0 : len < 65536 ? 2 : 8;
  const head = Buffer.alloc(2 + lenBytes + (mask ? 4 : 0));
  head[0] = 0x80 | opcode;
  head[1] = (mask ? 0x80 : 0) | (lenBytes === 0 ? len : lenBytes === 2 ? 126 : 127);
  if (lenBytes === 2) head.writeUInt16BE(len, 2);
  if (lenBytes === 8) head.writeBigUInt64BE(BigInt(len), 2);
  if (!mask) return Buffer.concat([head, payload]);
  mask.copy(head, 2 + lenBytes);
  return Buffer.concat([head, Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))]);
}

/** Decodes the first complete frame of `buf`; null when more bytes are needed. `rest` is what follows it. */
export function decodeFrame(buf: Buffer): { frame: WsFrame; rest: Buffer } | null {
  if (buf.length < 2) return null;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  const maskAt = offset;
  if (masked) offset += 4;
  if (buf.length < offset + len) return null;
  const raw = buf.subarray(offset, offset + len);
  const payload = masked ? Buffer.from(raw.map((b, i) => b ^ buf[maskAt + (i % 4)])) : Buffer.from(raw);
  return { frame: { fin: (buf[0] & 0x80) !== 0, opcode: buf[0] & 0x0f, payload }, rest: buf.subarray(offset + len) };
}

/** Reassembles a byte stream into complete messages (text/binary, joining continuation frames) and control frames. */
export function createFrameReader(onFrame: (opcode: number, payload: Buffer) => void): (chunk: Buffer) => void {
  let buffered: Buffer = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let messageOpcode: number = OPCODES.text;
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (let next = decodeFrame(buffered); next; next = decodeFrame(buffered)) {
      buffered = next.rest;
      const { fin, opcode, payload } = next.frame;
      if (opcode >= OPCODES.close) {
        onFrame(opcode, payload);
        continue;
      }
      if (opcode !== OPCODES.continuation) messageOpcode = opcode;
      parts.push(payload);
      if (!fin) continue;
      onFrame(messageOpcode, Buffer.concat(parts));
      parts = [];
    }
  };
}
