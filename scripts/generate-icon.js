'use strict';

// Generates images/icon.png (128x128) without any image dependency.
// usage: node scripts/generate-icon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;

// Elasticsearch-ish palette
const BACKGROUND = [0x00, 0x55, 0x71];
const ACCENT = [0x00, 0xbf, 0xb3];
const WHITE = [0xf5, 0xf7, 0xfa];

function blend(base, top, alpha) {
    return [
        Math.round(base[0] * (1 - alpha) + top[0] * alpha),
        Math.round(base[1] * (1 - alpha) + top[1] * alpha),
        Math.round(base[2] * (1 - alpha) + top[2] * alpha)
    ];
}

// Signed distance to a ring (annulus) centred at cx,cy.
function ringDistance(x, y, cx, cy, radius, thickness) {
    const dx = x - cx;
    const dy = y - cy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return Math.abs(distance - radius) - thickness / 2;
}

// Signed distance to a capsule (thick line segment).
function capsuleDistance(x, y, x1, y1, x2, y2, radius) {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const wx = x - x1;
    const wy = y - y1;
    const lengthSquared = vx * vx + vy * vy;
    let t = lengthSquared === 0 ? 0 : (wx * vx + wy * vy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * vx;
    const py = y1 + t * vy;
    const dx = x - px;
    const dy = y - py;
    return Math.sqrt(dx * dx + dy * dy) - radius;
}

function coverage(distance) {
    // 1px anti-aliasing band.
    return Math.max(0, Math.min(1, 0.5 - distance));
}

function buildPixels() {
    const rows = [];

    for(let y = 0; y < SIZE; y++) {

        // PNG scanlines are prefixed with a filter byte (0 = none).
        const row = [0];

        for(let x = 0; x < SIZE; x++) {

            let color = BACKGROUND;

            // Subtle diagonal accent band across the lower right corner.
            const band = (x + y) - 150;
            if(band > 0) {
                const alpha = Math.min(0.28, band / 90);
                color = blend(color, ACCENT, alpha);
            }

            // Magnifier ring.
            const ring = ringDistance(x + 0.5, y + 0.5, 56, 52, 30, 11);
            color = blend(color, WHITE, coverage(ring));

            // Magnifier handle.
            const handle = capsuleDistance(x + 0.5, y + 0.5, 78, 74, 104, 100, 6.5);
            color = blend(color, WHITE, coverage(handle));

            row.push(color[0], color[1], color[2], 0xff);
        }

        rows.push(Buffer.from(row));
    }

    return Buffer.concat(rows);
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const typeBuffer = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuffer, data]);

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcInput) >>> 0, 0);

    return Buffer.concat([length, typeBuffer, data, crc]);
}

let crcTable = null;

function crc32(buffer) {

    if(!crcTable) {
        crcTable = new Int32Array(256);

        for(let n = 0; n < 256; n++) {
            let c = n;

            for(let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            }

            crcTable[n] = c;
        }
    }

    let crc = -1;

    for(let i = 0; i < buffer.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
    }

    return crc ^ -1;
}

function buildPng() {

    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const header = Buffer.alloc(13);
    header.writeUInt32BE(SIZE, 0);   // width
    header.writeUInt32BE(SIZE, 4);   // height
    header[8] = 8;                   // bit depth
    header[9] = 6;                   // colour type: RGBA
    header[10] = 0;                  // compression
    header[11] = 0;                  // filter
    header[12] = 0;                  // interlace

    const pixels = buildPixels();
    const compressed = zlib.deflateSync(pixels, { level: 9 });

    return Buffer.concat([
        signature,
        chunk('IHDR', header),
        chunk('IDAT', compressed),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

const output = path.resolve(__dirname, '..', 'images', 'icon.png');
fs.writeFileSync(output, buildPng());
console.log('wrote', output, fs.statSync(output).size, 'bytes');
