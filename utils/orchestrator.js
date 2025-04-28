// Using native fetch (Node 18+)
const Ajv = require('ajv');
const ContentChunker = require('./contentChunker');
require('dotenv').config();

// --- Configuration ---
const API_URL = process.env.LLM_API_URL;
const BEARER_TOKEN = process.env.API_TOKEN;
const MODEL_NAME = process.env.LLM_MODEL_NAME;
const MAX_RETRIES = 2;
const SENTINEL = '###END_OF_JSON###';

// --- JSON Schema (expanded) ---
const schema = {
  type: 'object',
  properties: {
    regulatory_context: {
      type: 'object',
      properties: {
        issuer: { type: 'string' },
        originalCircular: {
          type: 'object',
          properties: {
            number: { type: 'integer' },
            issueDate: { type: 'string' },
            scope: { type: 'string' }
          },
          required: ['number','issueDate','scope']
        },
        withdrawal: {
          type: 'object',
          properties: {
            circularNumber: { type: 'integer' },
            effectiveDate: { type: 'string' },
            issuedBy: { type: 'string' }
          },
          required: ['circularNumber','effectiveDate','issuedBy']
        }
      },
      required: ['issuer','originalCircular','withdrawal']
    },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          description: { type: 'string' },
          status: { type: 'string' }
        },
        required: ['id','description','status']
      }
    },
    impact_and_risk: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          risk: { type: 'string' },
          impact: { type: 'string' }
        },
        required: ['risk','impact']
      }
    },
    ambiguities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          detail: { type: 'string' }
        },
        required: ['detail']
      }
    },
    executive_summary: { type: 'string' },
    key_obligations_table: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          obligation: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['obligation','description']
      }
    },
    responsibility_matrix: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          responsibility: { type: 'string' }
        },
        required: ['role','responsibility']
      }
    },
    visual_aids: {
      type: 'object',
      properties: {
        timeline: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              event: { type: 'string' }
            },
            required: ['date','event']
          }
        }
      },
      required: ['timeline']
    }
  },
  required: ['regulatory_context','requirements','impact_and_risk','ambiguities','executive_summary','key_obligations_table','responsibility_matrix','visual_aids']
};
const ajv = new Ajv();
const validateFinal = ajv.compile(schema);

async function callLLM(messages, attempt = 0) {
  console.log(`[orchestrator] callLLM attempt ${attempt+1}, URL: ${API_URL}`);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: MODEL_NAME, messages, temperature:0.2, top_p:0.9, frequency_penalty:1, max_tokens:1200 })
    });
  } catch (err) {
    console.error(`[orchestrator] fetch error on attempt ${attempt+1}:`, err);
    throw err;
  }
  console.log(`[orchestrator] callLLM response status: ${res.status}`);
  if (!res.ok) {
    console.error(`[orchestrator] LLM returned error status ${res.status}`);
    throw new Error(`LLM Error ${res.status}`);
  }
  const json = await res.json();
  console.log(`[orchestrator] raw response:`, JSON.stringify(json, null, 2));
  const text = json.choices?.[0]?.message?.content || '';
  console.log(`[orchestrator] extracted text: ${text.slice(0,200)}...`);
  // Bypass sentinel; return raw trimmed content
  return text.trim();
}

async function orchestrateText(text) {
  const startTime = new Date();
  console.log(`[orchestrator] [${startTime.toISOString()}] orchestrateText start`);
  
  // Single comprehensive analysis instead of chunking
  const messages = [
    { 
      role: 'system', 
      content: [
        'You are an expert regulatory analyst. Analyze the provided document following these steps:',
        '',
        '1. Identify the main purpose: Determine what the document aims to achieve.',
        '',
        '2. Read carefully: Focus on key sections such as introductions, definitions, and conclusions.',
        '',
        '3. Break it down: Analyze the document structure and organization.',
        '',
        '4. Identify key points: Extract requirements, restrictions, timelines, and compliance obligations.',
        '',
        '5. Write a comprehensive summary using this template:',
        '',
        'Title: [Document Name] Summary',
        '==============================',
        '',
        'Overview',
        '--------',
        '[Briefly describe the document, including its purpose and scope]',
        '',
        'Main Provisions',
        '---------------',
        '* [Key provision 1]',
        '* [Key provision 2]',
        '* [Key provision 3]',
        '',
        'Key Changes (if applicable)',
        '-------------------------',
        '[List significant changes from previous versions]',
        '',
        'Impact on Organizations and Individuals',
        '---------------------------------------',
        '[Describe consequences for non-compliance and strategies for compliance]',
        '',
        'Monitoring and Enforcement',
        '-------------------------',
        '[Explain how compliance is tracked and enforced]',
        '',
        'Conclusion',
        '----------',
        '[Summarize importance of understanding this regulation]',
        '',
        '6. Format as clean Markdown without code blocks or other formatting artifacts.'
      ].join('\n') 
    },
    { role: 'user', content: text }
  ];
  
  console.log(`[orchestrator] [${new Date().toISOString()}] Calling LLM for comprehensive summary...`);
  
  try {
    var rawSummary = await callLLM(messages);
    console.log(`[orchestrator] [${new Date().toISOString()}] LLM response received.`);
  } catch (err) {
    console.error(`[orchestrator] [${new Date().toISOString()}] Error on LLM call:`, err);
    throw err;
  }
  
  // Clean the markdown output
  const markdownSummary = rawSummary
    .replace(/```(?:markdown)?\n?/g, '')
    .replace(/```/g, '')
    .trim();
  
  // Create the result object with the markdown summary
  const finalResult = {
    version: "2.0",
    format: "markdown",
    summary: markdownSummary,
    generatedAt: new Date().toISOString(),
    sourceLength: text.length
  };
  
  const endTime = new Date();
  console.log(`[orchestrator] [${endTime.toISOString()}] orchestrateText completed (total duration: ${endTime - startTime}ms)`);
  return finalResult;
}

module.exports = { orchestrateText };
