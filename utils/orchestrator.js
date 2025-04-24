const fetch = require('node-fetch');
const Ajv = require('ajv');
const pLimit = require('p-limit');
const ContentChunker = require('./contentChunker');

// --- Configuration ---
const API_URL = 'https://api.perplexity.ai/chat/completions';
const BEARER_TOKEN = process.env.API_TOKEN;
const MODEL_NAME = 'sonar';
const CONCURRENCY = parseInt(process.env.LLM_CONCURRENCY, 10) || 4;
const MAX_RETRIES = 2;
const SENTINEL = '###END_OF_JSON###';

// --- JSON Schema (simplified stub) ---
const schema = {
  type: 'object',
  properties: {
    regulatory_context: { type: 'object' },
    requirements: { type: 'array' },
    impact_and_risk: { type: 'array' },
    ambiguities: { type: 'array' },
    executive_summary: { type: 'string' },
    key_obligations_table: { type: 'array' },
    responsibility_matrix: { type: 'array' },
    visual_aids: { type: 'object' }
  },
  required: ['regulatory_context','requirements','executive_summary']
};
const ajv = new Ajv();
const validateFinal = ajv.compile(schema);

function buildStage1Messages(chunk, idx, total) {
  return [
    { role: 'system', content: [
      'You are a senior compliance officer at a large financial institution.',
      'Only use the provided chunk content; do not introduce any external information or assumptions.',
      'Be precise and comprehensive, not just concise.',
      'When you analyze regulatory text, follow these steps exactly:',
      '1. Regulatory Context...','2. Decompose Requirements...','3. Interpret Ambiguities...','4. Capture Details...',
      'Output each section in JSON under keys: context, requirements, ambiguities, details.',
      `// chunk ${idx+1}/${total}`,
      SENTINEL
    ].join(' ')},
    { role: 'user', content: chunk }
  ];
}

function buildStage2Messages(results) {
  return [
    { role: 'system', content: [
      'You are an expert compliance synthesizer.',
      'Only use the provided chunk-level JSON; do not add or infer any data not present in the inputs.',
      'Combine the following chunk-level JSON objects into one final JSON matching the schema below:',
      JSON.stringify(schema, null, 2),
      'Include every item, do not abbreviate.',
      SENTINEL
    ].join('\n')},
    { role: 'user', content: JSON.stringify(results) }
  ];
}

async function callLLM(messages, attempt = 0) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: MODEL_NAME, messages, temperature:0.2, top_p:0.9, frequency_penalty:1, max_tokens:1200 })
  });
  if (!res.ok) throw new Error(`LLM Error ${res.status}`);
  let text = (await res.json()).choices[0].message.content || '';
  if (!text.includes(SENTINEL) && attempt < MAX_RETRIES) {
    console.warn(`Missing sentinel, retrying attempt ${attempt+1}`);
    return callLLM(messages, attempt+1);
  }
  return text.replace(SENTINEL, '').trim();
}

async function parseJsonWithRetry(raw, messages, retries = MAX_RETRIES) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (retries > 0) {
      console.warn('JSON parse failed, retrying...');
      const fresh = await callLLM(messages);
      return parseJsonWithRetry(fresh, messages, retries-1);
    }
    throw new Error('Failed to parse JSON after retries');
  }
}

async function orchestrateText(text) {
  const chunks = ContentChunker.splitIntoChunks(text);
  const limit = pLimit(CONCURRENCY);
  const promises = chunks.map((c,i) => limit(async () => {
    const msgs = buildStage1Messages(c, i, chunks.length);
    const raw = await callLLM(msgs);
    return parseJsonWithRetry(raw, msgs);
  }));
  const chunkResults = await Promise.all(promises);

  const mergeMsgs = buildStage2Messages(chunkResults);
  const mergedRaw = await callLLM(mergeMsgs);
  const finalJson = await parseJsonWithRetry(mergedRaw, mergeMsgs);

  if (!validateFinal(finalJson)) {
    console.error('Final JSON schema errors:', validateFinal.errors);
  }
  return finalJson;
}

module.exports = { orchestrateText };
