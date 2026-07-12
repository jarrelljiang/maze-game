import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lame from '@breezystack/lamejs';

const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 24;
const TOTAL_SAMPLES = SAMPLE_RATE * DURATION_SECONDS;
const BEAT_SECONDS = 0.75;
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/audio/desert-ruins-loop.mp3');
const samples = new Float64Array(TOTAL_SAMPLES);

/**
 * 计算音符包络，避免起音和结束时产生爆音。
 * @param {number} time 音符内的当前时间。
 * @param {number} duration 音符持续时间。
 * @param {number} attack 起音时间。
 * @param {number} release 衰减时间。
 * @returns {number} 0 到 1 的音量系数。
 */
function envelopeAt(time, duration, attack, release) {
  if (time < 0 || time > duration) return 0;
  const attackGain = Math.min(1, time / Math.max(attack, 0.001));
  const releaseGain = Math.min(1, (duration - time) / Math.max(release, 0.001));
  return Math.max(0, Math.min(attackGain, releaseGain));
}

/**
 * 向总音轨叠加带少量泛音的柔和音符。
 * @param {number} frequency 基频。
 * @param {number} startSeconds 开始时间。
 * @param {number} durationSeconds 持续时间。
 * @param {number} volume 峰值音量。
 * @param {number} attackSeconds 起音时间。
 * @param {number} releaseSeconds 衰减时间。
 */
function addTone(frequency, startSeconds, durationSeconds, volume, attackSeconds, releaseSeconds) {
  const start = Math.floor(startSeconds * SAMPLE_RATE);
  const end = Math.min(TOTAL_SAMPLES, Math.ceil((startSeconds + durationSeconds) * SAMPLE_RATE));
  for (let index = start; index < end; index += 1) {
    const time = index / SAMPLE_RATE - startSeconds;
    const envelope = envelopeAt(time, durationSeconds, attackSeconds, releaseSeconds);
    const phase = Math.PI * 2 * frequency * time;
    const tone = Math.sin(phase) + Math.sin(phase * 2) * 0.22 + Math.sin(phase * 3) * 0.08;
    samples[index] += tone * envelope * volume;
  }
}

/**
 * 叠加短促低频手鼓音色。
 * @param {number} startSeconds 手鼓开始时间。
 * @param {number} volume 手鼓音量。
 */
function addDrum(startSeconds, volume) {
  const duration = 0.42;
  const start = Math.floor(startSeconds * SAMPLE_RATE);
  const end = Math.min(TOTAL_SAMPLES, Math.ceil((startSeconds + duration) * SAMPLE_RATE));
  for (let index = start; index < end; index += 1) {
    const time = index / SAMPLE_RATE - startSeconds;
    const progress = time / duration;
    const frequency = 92 - progress * 48;
    const envelope = Math.exp(-time * 11);
    samples[index] += Math.sin(Math.PI * 2 * frequency * time) * envelope * volume;
  }
}

/**
 * 叠加轻微沙粒感的高频节奏。
 * @param {number} startSeconds 沙锤开始时间。
 * @param {number} volume 沙锤音量。
 * @param {number} seed 可复现的噪声种子。
 */
function addShaker(startSeconds, volume, seed) {
  const duration = 0.11;
  const start = Math.floor(startSeconds * SAMPLE_RATE);
  const end = Math.min(TOTAL_SAMPLES, Math.ceil((startSeconds + duration) * SAMPLE_RATE));
  let state = seed >>> 0;
  let previousNoise = 0;
  for (let index = start; index < end; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const noise = state / 0xffffffff * 2 - 1;
    const highPassNoise = noise - previousNoise * 0.82;
    previousNoise = noise;
    const time = index / SAMPLE_RATE - startSeconds;
    samples[index] += highPassNoise * Math.exp(-time * 34) * volume;
  }
}

/**
 * 将浮点采样编码为单声道 MP3。
 * @param {Float64Array} source 浮点音频采样。
 * @param {string} destination 输出文件路径。
 */
function writeMp3(source, destination) {
  let peak = 0;
  for (const sample of source) peak = Math.max(peak, Math.abs(sample));
  const normalization = peak > 0 ? 0.86 / peak : 1;
  const pcm = new Int16Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index] * normalization));
    pcm[index] = Math.round(sample * 32767);
  }
  const encoder = new lame.Mp3Encoder(1, SAMPLE_RATE, 96);
  const chunks = [];
  const blockSize = 1152;
  for (let offset = 0; offset < pcm.length; offset += blockSize) {
    const encoded = encoder.encodeBuffer(pcm.subarray(offset, offset + blockSize));
    if (encoded.length) chunks.push(Buffer.from(encoded));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Buffer.from(tail));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.concat(chunks));
}

// 四组缓慢变化的和声铺底，首尾淡入淡出以适合循环播放。
const chords = [
  [73.42, 110, 146.83],
  [58.27, 87.31, 116.54],
  [65.41, 98, 130.81],
  [55, 82.41, 110],
];
chords.forEach((chord, chordIndex) => {
  chord.forEach((frequency, noteIndex) => {
    addTone(frequency, chordIndex * 6, 6, 0.07 - noteIndex * 0.012, 0.45, 0.65);
  });
});

// D 小调五声音阶旋律，留出空拍以保持探索空间感。
const melody = [146.83, 174.61, 196, null, 220, 196, 174.61, null, 261.63, 220, 196, 174.61, 146.83, null, 174.61, 220,
  146.83, 196, 220, null, 261.63, 220, 196, null, 174.61, 196, 146.83, null, 220, 174.61, 146.83, null];
melody.forEach((frequency, beatIndex) => {
  const start = beatIndex * BEAT_SECONDS;
  if (frequency) {
    addTone(frequency, start, 1.15, 0.11, 0.025, 0.8);
    if (beatIndex % 4 === 2) addTone(frequency, start + 0.28, 0.85, 0.035, 0.02, 0.55);
  }
  if (beatIndex % 4 === 0) addDrum(start, 0.09);
  if (beatIndex % 2 === 1) addShaker(start + BEAT_SECONDS * 0.5, 0.014, 731 + beatIndex * 17);
});

writeMp3(samples, outputPath);
console.log(`Generated ${outputPath}`);
