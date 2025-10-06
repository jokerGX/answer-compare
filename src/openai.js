const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const apiKey = process.env.OPENAI_API_KEY;
let client = null;
if (apiKey) {
  client = new OpenAI({ apiKey });
}

function fileToDataUrl(filePath) {
  const abs = path.resolve(filePath);
  const buf = fs.readFileSync(abs);
  const b64 = buf.toString('base64');
  const ext = path.extname(abs).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'application/octet-stream';
  return `data:${mime};base64,${b64}`;
}

async function getEmbedding(text) {
  if (!client) throw new Error('OpenAI not configured');
  const input = String(text || '').trim();
  const resp = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input
  });
  return resp.data[0].embedding;
}

async function extractQAFromImage(filePath) {
  if (!client) throw new Error('OpenAI not configured');
  const dataUrl = fileToDataUrl(filePath);

  const schema = {
    name: 'qa_items',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              questionText: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              chosenAnswers: { type: 'array', items: { type: 'string' } }
            },
            required: ['questionText', 'options', 'chosenAnswers']
          }
        }
      },
      required: ['items']
    },
    strict: false
  };

  const inputText = [
    'Extract ONLY the questions and the answers SELECTED by the user from the screenshot.',
    'Rules:',
    '- Do not include numbering like 1., 2., (a), or roman numerals, if a graphical element is present, do not include it.',
    '- For True/False, set chosenAnswers to ["True"] or ["False"].',
    '- If multiple selections are visible for a question, include all in chosenAnswers.',
    '- Always include an options array; if not visible, set options: [].',
    '- Output JSON strictly matching the provided schema.'
  ].join('\n');

  const response = await client.responses.create({
    model: 'gpt-5-mini',
    input: [
      { role: 'system', content: 'You extract structured data from images.' },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: inputText },
          { type: 'input_image', image_url: dataUrl }
        ]
      }
    ],
    text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: schema.strict } }
  });

  const text = response.output_text || JSON.stringify(response.output || {});
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    const match = text.match(/```json\n([\s\S]*?)```/);
    if (match) parsed = JSON.parse(match[1]);
  }
  if (!parsed || !parsed.items) return { items: [] };
  // Normalize
  const items = parsed.items.map(it => ({
    questionText: String(it.questionText || '').trim(),
    options: Array.isArray(it.options) ? it.options.map(o => String(o || '').trim()).filter(Boolean) : undefined,
    chosenAnswers: Array.isArray(it.chosenAnswers) ? it.chosenAnswers.map(a => String(a || '').trim()).filter(Boolean) : []
  })).filter(it => it.questionText && it.chosenAnswers.length > 0);

  return { items };
}

module.exports = { extractQAFromImage, getEmbedding };


