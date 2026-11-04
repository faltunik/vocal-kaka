#!/usr/bin/env node
/**
 * Generates the Vocal Kaka logo assets (pure Node: zlib + CRC, no native deps).
 *
 * Design: a microphone mark (capsule + U arc + stem + base) on a dark
 * (#111113) tile, matching the app's minimal light theme.
 *
 * Usage: node scripts/generate-logo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(rootDir, 'assets', 'images');

const INK = [0x11, 0x11, 0x13, 255];
const WHITE = [255, 255, 255, 255];
const LIGHT = [0xf7, 0xf7, 0xf8, 255];

// --- PNG encoder ------------------------------------------------------------
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter: none
        Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// --- Rasterizer (signed-distance coverage) ----------------------------------
// Source-over compositing for straight (unpremultiplied) RGBA output.
// `alpha` is the source coverage; the source color is opaque.
function mix(base, over, alpha) {
    const da = base[3] / 255;
    const outA = alpha + da * (1 - alpha);
    if (outA <= 0) return [0, 0, 0, 0];

    return [
        Math.round((over[0] * alpha + base[0] * da * (1 - alpha)) / outA),
        Math.round((over[1] * alpha + base[1] * da * (1 - alpha)) / outA),
        Math.round((over[2] * alpha + base[2] * da * (1 - alpha)) / outA),
        Math.round(outA * 255),
    ];
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
    const qx = Math.abs(px - cx) - (hw - r);
    const qy = Math.abs(py - cy) - (hh - r);
    const ax = Math.max(qx, 0);
    const ay = Math.max(qy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by, thickness) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - thickness / 2;
}

function coverage(distance) {
    return Math.max(0, Math.min(1, 0.5 - distance));
}

/**
 * Draws the microphone mark. `size` is the canvas size; geometry scales with it.
 * `color` is the glyph color. `compact` renders a simplified head+cradle mark
 * that stays legible at favicon sizes.
 */
function drawMic(rgba, size, color, scale = 1, offsetY = 0, compact = false) {
    const c = size / 2;
    const s = size / 1024 * scale;
    const y = (v) => c + (v - 512) * s + offsetY;

    const shapes = compact
        ? [
            // Bold capsule head
            (px, py) => sdRoundRect(px, py, c, y(430), 118 * s, 190 * s, 118 * s),
            // Bold cradle
            (px, py) => {
                const cx = c;
                const cy = y(600);
                const radius = 215 * s;
                const thickness = 92 * s;
                const ring = Math.abs(Math.hypot(px - cx, py - cy) - radius) - thickness / 2;
                return Math.max(ring, cy - py);
            },
        ]
        : [
            // Capsule head
            (px, py) => sdRoundRect(px, py, c, y(371), 95 * s, 165 * s, 95 * s),
            // U-shaped arc: ends on the capsule's bottom line, wrapping below it
            (px, py) => {
                const cx = c;
                const cy = y(536);
                const radius = 185 * s;
                const thickness = 62 * s;
                const ring = Math.abs(Math.hypot(px - cx, py - cy) - radius) - thickness / 2;
                const lowerHalf = cy - py; // negative below the center line
                return Math.max(ring, lowerHalf);
            },
            // Stem
            (px, py) => sdSegment(px, py, c, y(650), c, y(745), 60 * s),
            // Base bar
            (px, py) => sdRoundRect(px, py, c, y(780), 170 * s, 33 * s, 33 * s),
        ];

    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            let alpha = 0;
            for (const shape of shapes) {
                alpha = Math.max(alpha, coverage(shape(px, py)));
            }
            if (alpha <= 0) continue;
            const index = (py * size + px) * 4;
            const current = [rgba[index], rgba[index + 1], rgba[index + 2], rgba[index + 3]];
            const merged = mix(current, color, alpha);
            rgba[index] = merged[0];
            rgba[index + 1] = merged[1];
            rgba[index + 2] = merged[2];
            rgba[index + 3] = merged[3];
        }
    }
}

function fill(rgba, color) {
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = color[3];
    }
}

function roundedTile(rgba, size, color, radiusRatio = 0.22, paddingRatio = 0) {
    const pad = size * paddingRatio;
    const radius = size * radiusRatio;
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const d = sdRoundRect(px, py, size / 2, size / 2, size / 2 - pad, size / 2 - pad, radius);
            const alpha = coverage(d);
            if (alpha <= 0) continue;
            const index = (py * size + px) * 4;
            const current = [rgba[index], rgba[index + 1], rgba[index + 2], rgba[index + 3]];
            const merged = mix(current, color, alpha);
            rgba[index] = merged[0];
            rgba[index + 1] = merged[1];
            rgba[index + 2] = merged[2];
            rgba[index + 3] = merged[3];
        }
    }
}

function blank(size) {
    return new Uint8Array(size * size * 4);
}

// --- Assets -----------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });

// iOS/store icon: full-bleed dark tile with the white mark.
{
    const size = 1024;
    const rgba = blank(size);
    fill(rgba, INK);
    drawMic(rgba, size, WHITE, 0.82);
    fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), encodePng(size, size, rgba));
}

// Splash: rounded dark tile on transparency.
{
    const size = 512;
    const rgba = blank(size);
    roundedTile(rgba, size, INK, 0.22, 0.02);
    drawMic(rgba, size, WHITE, 0.72);
    fs.writeFileSync(path.join(OUT_DIR, 'splash-icon.png'), encodePng(size, size, rgba));
}

// Web favicon (compact mark for small-size legibility).
{
    const size = 64;
    const rgba = blank(size);
    fill(rgba, INK);
    drawMic(rgba, size, WHITE, 1, 0, true);
    fs.writeFileSync(path.join(OUT_DIR, 'favicon.png'), encodePng(size, size, rgba));
}

// Android adaptive icon: dark mark on the light background layer.
{
    const size = 1024;
    const foreground = blank(size);
    drawMic(foreground, size, INK, 0.72);
    fs.writeFileSync(path.join(OUT_DIR, 'android-icon-foreground.png'), encodePng(size, size, foreground));

    const background = blank(size);
    fill(background, LIGHT);
    fs.writeFileSync(path.join(OUT_DIR, 'android-icon-background.png'), encodePng(size, size, background));

    const monochrome = blank(size);
    drawMic(monochrome, size, WHITE, 0.72);
    fs.writeFileSync(path.join(OUT_DIR, 'android-icon-monochrome.png'), encodePng(size, size, monochrome));
}

console.log('[logo] wrote icon.png, splash-icon.png, favicon.png and Android layers to assets/images/');
