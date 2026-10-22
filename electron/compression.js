'use strict';

function compressionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function calculateFitTarget({ duration, targetMb }) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 7 * 24 * 3600)
    throw compressionError('bad-duration', 'Could not read a valid video duration.');
  if (!Number.isFinite(targetMb) || targetMb < 1 || targetMb > 10000)
    throw compressionError('bad-target', 'Enter a target between 1 and 10,000 MB.');
  const total = targetMb * 8000 / duration;
  const audioKbps = total < 256 ? 64 : total < 512 ? 96 : 128;
  const videoKbps = Math.min(100000,Math.floor(total * 0.95 - audioKbps));
  if (!Number.isFinite(videoKbps) || videoKbps < 32)
    throw compressionError('target-unrealistic', 'That size would leave too little video bitrate. Choose a larger target.');
  return { videoKbps, audioKbps };
}

function buildTwoPassArgs({ duration, targetMb, input = 'input.bin', output = 'output.mp4', passlog = 'jd-pass' }) {
  const { videoKbps, audioKbps } = calculateFitTarget({ duration, targetMb });
  const common = ['-c:v', 'libx264', '-threads', '4', '-pix_fmt', 'yuv420p', '-b:v', `${videoKbps}k`, '-preset', 'slow', '-passlogfile', passlog];
  const pass1 = ['-y', '-i', input, ...common, '-pass', '1', '-an', '-f', 'null', '-'];
  const pass2 = ['-y', '-i', input, ...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-movflags', '+faststart', output];
  return { videoKbps, audioKbps, pass1, pass2 };
}

function buildCompressionArgs({ mode, duration, targetMb, input = 'input.mp4', output = 'output.mp4' }) {
  if (!['quality', 'size'].includes(mode)) throw compressionError('bad-mode', 'Choose a compression mode.');
  if (mode === 'quality') return ['-i', input, '-c:v', 'libx264', '-threads', '4', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output];
  const { videoKbps, audioKbps } = calculateFitTarget({ duration, targetMb });
  return ['-i', input, '-c:v', 'libx264', '-threads', '4', '-pix_fmt', 'yuv420p', '-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps}k`, '-bufsize', `${videoKbps * 2}k`, '-preset', 'slow', '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-movflags', '+faststart', output];
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildCompressionArgs, calculateFitTarget, buildTwoPassArgs };
if (typeof window !== 'undefined') window.JDCompression = { buildCompressionArgs, calculateFitTarget };
