const fs = require('fs');
const path = require('path');

let queueTimer = null;
let processing = false;
let activeSettings = null;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 120_000, 300_000, 900_000, 1800_000];

function descriptionsPath(saveDir) {
  return path.join(saveDir, 'descriptions.json');
}

function queuePath(saveDir) {
  return path.join(saveDir, 'descriptions-queue.json');
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readDescriptions(saveDir) {
  return readJson(descriptionsPath(saveDir), {});
}

function writeDescriptionRecord(saveDir, imageName, patch) {
  const data = readDescriptions(saveDir);
  const existing = typeof data[imageName] === 'object' && data[imageName] !== null
    ? data[imageName]
    : { description: data[imageName] || '' };
  data[imageName] = { ...existing, ...patch, updatedAt: nowIso() };
  writeJson(descriptionsPath(saveDir), data);
}

function readQueue(saveDir) {
  const q = readJson(queuePath(saveDir), []);
  return Array.isArray(q) ? q : [];
}

function writeQueue(saveDir, q) {
  writeJson(queuePath(saveDir), q);
}

function cleanModelText(text) {
  let out = String(text || '');
  const channelEnd = out.lastIndexOf('<channel|>');
  if (channelEnd !== -1) out = out.slice(channelEnd + '<channel|>'.length);
  return out
    .replace(/<\|channel\>\s*(thought|analysis|reasoning|final)?/gi, '')
    .replace(/<\|?\/?(thought|analysis|reasoning)\|?>[\s\S]*?<\|?\/?(final|answer)\|?>/gi, '')
    .replace(/<\|[^>]+\|>/g, '')
    .trim();
}

function extractText(json) {
  const text = json?.choices?.[0]?.message?.content
    || json?.output_text
    || json?.output?.flatMap(o => o.content || []).map(c => c.text || '').join('\n')
    || '';
  return cleanModelText(text);
}

function baseUrl(lm) {
  const host = (lm.address || 'localhost').replace(/^https?:\/\//, '');
  const port = lm.port || '1234';
  return `http://${host}:${port}`;
}

async function loadModel(lm) {
  const model = lm.model || 'gemma-3-4b-it';
  const res = await fetch(`${baseUrl(lm)}/api/v1/models/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model })
  });
  if (!res.ok) {
    const text = await res.text();
    if (!/already|loaded/i.test(text)) throw new Error(`LM Studio model load HTTP ${res.status}: ${text}`);
  }
}

async function chatCompletion(filePath, settings) {
  const lm = settings.lmStudio || {};
  const base64 = fs.readFileSync(filePath).toString('base64');
  const ext = path.extname(filePath).toLowerCase() === '.jpg' ? 'jpeg' : 'png';
  const body = {
    model: lm.model || 'gemma-3-4b-it',
    stream: false,
    temperature: 0.2,
    messages: [
      { role: 'system', content: `${lm.systemPrompt || 'Describe this screenshot clearly and concisely.'}\n\nReturn only the final user-facing description. Do not include reasoning, thoughts, analysis, channel markers, or scratchpad text.` },
      { role: 'user', content: [
        { type: 'text', text: 'Describe this screenshot.' },
        { type: 'image_url', image_url: { url: `data:image/${ext};base64,${base64}` } }
      ] }
    ]
  };
  const res = await fetch(`${baseUrl(lm)}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`LM Studio HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runInference(filePath, settings) {
  const lm = settings.lmStudio || {};
  if (lm.autoLoad !== false) await loadModel(lm);
  const json = await chatCompletion(filePath, settings);
  return extractText(json).trim();
}

function enqueueDescription(filePath, settings) {
  const lm = settings.lmStudio || {};
  if (!lm.enabled) return;
  activeSettings = settings;
  const saveDir = settings.saveDir;
  const imageName = path.basename(filePath);
  const q = readQueue(saveDir);
  if (!q.some(j => j.imageName === imageName && !['done', 'failed'].includes(j.status))) {
    q.push({ imageName, filePath, status: 'pending', attempts: 0, nextRunAt: Date.now(), createdAt: nowIso(), updatedAt: nowIso() });
    writeQueue(saveDir, q);
    writeDescriptionRecord(saveDir, imageName, { status: 'pending', description: '', error: '', createdAt: nowIso() });
  }
  scheduleQueue(0);
}

function startDescriptionQueue(settings) {
  activeSettings = settings;
  if (settings?.lmStudio?.enabled) scheduleQueue(0);
}

function scheduleQueue(delay = 1000) {
  clearTimeout(queueTimer);
  queueTimer = setTimeout(processQueue, delay);
}

async function processQueue() {
  if (processing || !activeSettings?.lmStudio?.enabled) return;
  processing = true;
  try {
    const saveDir = activeSettings.saveDir;
    let q = readQueue(saveDir);
    const now = Date.now();
    const job = q.find(j => ['pending', 'retry'].includes(j.status) && (j.nextRunAt || 0) <= now);
    if (!job) {
      const next = q.filter(j => ['pending', 'retry'].includes(j.status)).sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))[0];
      if (next) scheduleQueue(Math.max(1000, (next.nextRunAt || now) - now));
      return;
    }

    job.status = 'processing';
    job.updatedAt = nowIso();
    writeQueue(saveDir, q);
    writeDescriptionRecord(saveDir, job.imageName, { status: 'processing', error: '' });

    if (!fs.existsSync(job.filePath)) throw new Error('Image file no longer exists');
    const description = await runInference(job.filePath, activeSettings);
    if (!description) throw new Error('Empty LM Studio response');

    q = readQueue(saveDir).filter(j => j.imageName !== job.imageName);
    writeQueue(saveDir, q);
    writeDescriptionRecord(saveDir, job.imageName, { status: 'done', description, error: '' });
  } catch (err) {
    const saveDir = activeSettings.saveDir;
    const q = readQueue(saveDir);
    const job = q.find(j => j.status === 'processing');
    if (job) {
      job.attempts = (job.attempts || 0) + 1;
      job.error = String(err.message || err);
      job.status = job.attempts >= MAX_ATTEMPTS ? 'failed' : 'retry';
      job.nextRunAt = Date.now() + (BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)] || BACKOFF_MS.at(-1));
      job.updatedAt = nowIso();
      writeQueue(saveDir, q);
      writeDescriptionRecord(saveDir, job.imageName, { status: job.status, error: job.error, attempts: job.attempts, nextRunAt: job.nextRunAt });
      console.error('LM Studio queue failed:', job.error);
    }
  } finally {
    processing = false;
    const q = activeSettings?.saveDir ? readQueue(activeSettings.saveDir) : [];
    if (q.some(j => ['pending', 'retry'].includes(j.status))) scheduleQueue(1000);
  }
}

module.exports = { enqueueDescription, startDescriptionQueue, descriptionsPath, queuePath, loadModel };
