'use strict';

// A small, stable boundary between Junk Drawer and the open-source projects that
// power it. UI tools should ask for capabilities (edit-video, transcribe, render,
// etc.), not reach into a provider's internal files. That lets us upgrade or swap
// providers without rebuilding the product around each dependency.

const CONTRACT_VERSION = 1;

const REQUIRED_CHECKS = Object.freeze([
  'availability',
  'input',
  'output',
  'cancel',
  'disk-space',
]);

const DEFINITIONS = Object.freeze([
  {
    id: 'opencut-next',
    name: 'OpenCut Next',
    role: 'video-editor',
    stage: 'planned',
    source: 'https://github.com/OpenCut-app/OpenCut',
    license: 'MIT',
    transport: 'editor-api',
    capabilities: ['edit-video', 'timeline', 'render', 'headless-render'],
    checks: [...REQUIRED_CHECKS, 'api-version', 'project-format'],
    note: 'Upstream is being rewritten. Connect through its public Editor API when that API is released and versioned.',
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    role: 'media-engine',
    stage: 'active',
    transport: 'process',
    capabilities: ['convert-image', 'convert-audio', 'convert-video', 'render', 'probe-media'],
    checks: [...REQUIRED_CHECKS, 'codec-support'],
  },
  {
    id: 'whisper-cpp',
    name: 'whisper.cpp',
    role: 'speech-engine',
    stage: 'active',
    transport: 'process',
    capabilities: ['transcribe', 'subtitle-timing'],
    checks: [...REQUIRED_CHECKS, 'model-ready', 'audio-decode'],
  },
  {
    id: 'realesrgan',
    name: 'Real-ESRGAN',
    role: 'image-engine',
    stage: 'active',
    transport: 'process',
    capabilities: ['upscale-image'],
    checks: [...REQUIRED_CHECKS, 'gpu-support'],
  },
  {
    id: 'yt-dlp',
    name: 'yt-dlp',
    role: 'download-engine',
    stage: 'active',
    transport: 'process',
    capabilities: ['download-video', 'download-audio'],
    checks: [...REQUIRED_CHECKS, 'network', 'site-support'],
  },
  {
    id: 'libarchive',
    name: 'libarchive.js',
    role: 'archive-engine',
    stage: 'active',
    transport: 'in-process',
    capabilities: ['read-archive', 'extract-archive'],
    checks: [...REQUIRED_CHECKS, 'encrypted-input'],
  },
  {
    id: 'pdf-lib',
    name: 'pdf-lib + PDF.js',
    role: 'document-engine',
    stage: 'active',
    transport: 'in-process',
    capabilities: ['read-pdf', 'edit-pdf', 'render-pdf'],
    checks: [...REQUIRED_CHECKS, 'encrypted-input', 'page-count'],
  },
]);

function integrationCatalog(availability = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    providers: DEFINITIONS.map(definition => ({
      ...definition,
      capabilities: [...definition.capabilities],
      checks: [...definition.checks],
      available: definition.stage === 'planned' ? false : availability[definition.id] !== false,
      blockedBy: definition.id === 'opencut-next' ? 'upstream-editor-api' : null,
    })),
  };
}

function validateCatalog(catalog) {
  if (!catalog || catalog.contractVersion !== CONTRACT_VERSION || !Array.isArray(catalog.providers)) {
    return { ok: false, error: 'bad-integration-catalog' };
  }
  const ids = new Set();
  for (const provider of catalog.providers) {
    if (!provider || !/^[a-z0-9-]+$/.test(provider.id || '') || ids.has(provider.id)) {
      return { ok: false, error: 'bad-provider-id' };
    }
    ids.add(provider.id);
    if (!Array.isArray(provider.capabilities) || !provider.capabilities.length) {
      return { ok: false, error: 'missing-capabilities', provider: provider.id };
    }
    if (!REQUIRED_CHECKS.every(check => provider.checks && provider.checks.includes(check))) {
      return { ok: false, error: 'missing-error-checks', provider: provider.id };
    }
  }
  return { ok: true };
}

module.exports = { CONTRACT_VERSION, REQUIRED_CHECKS, integrationCatalog, validateCatalog };
