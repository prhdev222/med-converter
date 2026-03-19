// functions/api/parse.js — AI drug parsing + D1 learning
// POST /api/parse  → check D1 → AI fallback → save to D1
// GET  /api/parse  → list all learned drugs from D1 (for sync)

const SYSTEM_PROMPT = `You are a Thai hospital pharmacist. Parse medication lines from Thai med reconciliation into doctor orders.
Return ONLY a JSON array. Each item: {"generic_name":"...","dose":"...","category":"antidiabetic|insulin|lipid|neuro|cardiac|hematology|respiratory|inhaler|allergy|gi|gout|thyroid|vitamin|topical|supply|unknown","route":"oral|SC|IV|inhaled|neb|spray","frequency":"OD|BID|TID|QID|PRN","timing":["morning"],"sig":"1xOD oral PC เช้า"}
No markdown. Thai: เช้า=morning, เพล=noon, เย็น=evening, ก่อนนอน=hs, หลังอาหาร=PC, ก่อนอาหาร=AC, ฉีด=SC`;

const CORS = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' };

// ── AI Providers ──
const ai = {
  async workersAI(env, p) {
    const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role:'system', content:SYSTEM_PROMPT }, { role:'user', content:p }],
      max_tokens:800, temperature:0.1,
    });
    return r.response;
  },
  async gemini(env, p) {
    const k = env.GEMINI_API_KEY; if (!k) throw new Error('No key');
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${k}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{parts:[{text:SYSTEM_PROMPT+'\n\n'+p}]}], generationConfig:{temperature:0.1,maxOutputTokens:800} }),
    });
    return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
  },
  async groq(env, p) {
    const k = env.GROQ_API_KEY; if (!k) throw new Error('No key');
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${k}`},
      body: JSON.stringify({ model:'llama-3.1-8b-instant', messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:p}], max_tokens:800, temperature:0.1 }),
    });
    return (await r.json()).choices?.[0]?.message?.content || '';
  },
};

async function callAI(env, prompt) {
  for (const name of ['workersAI','gemini','groq']) {
    try {
      const raw = await ai[name](env, prompt);
      const clean = raw.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
      return { provider:name, data:JSON.parse(clean) };
    } catch(e) { console.error(`[${name}]`, e.message); }
  }
  throw new Error('All AI providers failed');
}

// ── D1: check if drug exists ──
async function findInD1(env, line) {
  if (!env.DB) return null;
  try {
    const drugs = await env.DB.prepare('SELECT * FROM learned_drugs').all();
    for (const d of drugs.results) {
      try {
        if (new RegExp(d.match_pattern, 'i').test(line)) {
          const dm = line.match(new RegExp(d.dose_pattern || '(\\d+)\\s*mg', 'i'));
          return {
            generic_name: d.generic_name,
            dose: dm ? dm[1] + ' mg' : '',
            category: d.category,
            route: d.route || 'oral',
            timing: JSON.parse(d.timing || '["morning"]'),
            sig: d.sig_template || '',
            source: 'd1-learned',
          };
        }
      } catch {}
    }
  } catch(e) { console.error('D1 read error:', e.message); }
  return null;
}

// ── D1: save new drug ──
async function saveToD1(env, item) {
  if (!env.DB || !item.generic_name) return;
  try {
    const exists = await env.DB.prepare(
      'SELECT id FROM learned_drugs WHERE LOWER(generic_name) = LOWER(?)'
    ).bind(item.generic_name).first();
    if (exists) return;

    const pattern = item.generic_name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await env.DB.prepare(
      `INSERT INTO learned_drugs (generic_name, match_pattern, category, route, sig_template, timing, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      item.generic_name, pattern,
      item.category || 'unknown',
      item.route || 'oral',
      item.sig || '',
      JSON.stringify(item.timing || ['morning']),
      'ai'
    ).run();
    console.log(`[D1] Saved: ${item.generic_name}`);
  } catch(e) { console.error('D1 write error:', e.message); }
}

// ── POST /api/parse ──
export async function onRequestPost(ctx) {
  try {
    const { lines } = await ctx.request.json();
    if (!lines?.length) return new Response(JSON.stringify({error:'No lines'}), {status:400,headers:CORS});

    const results = [];
    const needAI = [];
    const needAIIdx = [];

    // Step 1: check D1 for each line
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const d1Match = await findInD1(ctx.env, lines[i]);
      if (d1Match) {
        results[i] = d1Match;
      } else {
        needAI.push(lines[i]);
        needAIIdx.push(i);
        results[i] = null; // placeholder
      }
    }

    // Step 2: batch AI call for unknowns
    if (needAI.length > 0) {
      try {
        const prompt = needAI.map((l,i) => `${i+1}. ${l}`).join('\n');
        const { provider, data } = await callAI(ctx.env, prompt);
        const aiResults = Array.isArray(data) ? data : [data];

        for (let j = 0; j < needAIIdx.length; j++) {
          const aiR = aiResults[j];
          if (aiR) {
            aiR.source = `ai-${provider}`;
            results[needAIIdx[j]] = aiR;
            // Save to D1 for next time
            await saveToD1(ctx.env, aiR);
          }
        }
      } catch(e) {
        console.error('AI batch failed:', e.message);
      }
    }

    // Fill nulls with fallback
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        results[i] = { generic_name: lines[i]?.substring(0,40) || 'Unknown', source:'fallback' };
      }
    }

    const d1Count = results.filter(r => r.source === 'd1-learned').length;
    const aiCount = results.filter(r => r.source?.startsWith('ai')).length;

    return new Response(JSON.stringify({
      results, count:results.length, d1_hits:d1Count, ai_calls:aiCount,
    }), {headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500,headers:CORS});
  }
}

// ── GET /api/parse → list learned drugs (for frontend sync) ──
export async function onRequestGet(ctx) {
  if (!ctx.env.DB) return new Response(JSON.stringify({drugs:[],error:'No D1'}), {headers:CORS});
  try {
    const r = await ctx.env.DB.prepare('SELECT * FROM learned_drugs ORDER BY created_at DESC').all();
    return new Response(JSON.stringify({drugs:r.results, count:r.results.length}), {headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500,headers:CORS});
  }
}

export async function onRequestOptions() { return new Response(null,{headers:CORS}); }
