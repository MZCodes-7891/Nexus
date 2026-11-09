// Grounding test: long class notes with details only this class has. Answerable questions must use the notes' facts;
// unanswerable ones must be refused, not guessed. Usage: node tests/model_compare_grounded.js model1 model2
const BASE = 'http://127.0.0.1:11434';
const filler = n => Array.from({ length: n }, (_, i) => `Review point ${i + 1}: in class we practised reading circuit diagrams, labelling the cell, switch, load and conductors, and checking that every loop is closed before measuring.`).join('\n');
const NOTES = `Science 9 – Unit D Electrical Principles – Ms. Halvorsen's class notes
${filler(25)}
Lab 4 (the "lemon battery" lab) used 3 lemons, zinc nails and copper strips; our class average voltage was 2.7 V.
Ms. Halvorsen's rule for the unit test: every calculation answer needs the formula, the substitution, and units, or it loses 1 mark.
The unit test is on November 19 and has 30 multiple-choice questions and 3 written-response questions.
${filler(25)}
Our class mnemonic for Ohm's law is "Very Important Rule" (V = I x R).
The vocabulary quiz covered 12 words; "load" was defined as "the part of a circuit that turns electrical energy into another form".
In the motor lab, group 3's motor spun for 41 seconds, the longest in the class.
${filler(25)}
The bonus question on Quiz 2 asked why birds can sit on power lines without being shocked.
Ms. Halvorsen said the efficiency of the class's model generator was about 18 percent.`;
const QUESTIONS = [
  ['What was our class average voltage in the lemon battery lab?', /2\.7/],
  ['What do I need to include in every calculation answer on the unit test?', /formula[\s\S]*(substitut|plug)[\s\S]*unit|unit[\s\S]*formula/i],
  ['When is the unit test and how many written-response questions does it have?', /19[\s\S]*3|3[\s\S]*19|three/i],
  ['What mnemonic does our class use for Ohm\'s law?', /very important rule/i],
  ['How efficient was the class model generator?', /18/],
  ['How long did group 3\'s motor spin?', /41/],
  ['How did our class define "load"?', /another form|turns electrical energy/i],
  ['What was the class average mark on Quiz 2?', null],
  ['How many marks is the lemon battery lab report worth?', null],
  ['What did Ms. Halvorsen say about using calculators on the unit test?', null],
  ['What resistance did group 3 measure in the motor lab?', null],
  ['What page of the textbook is the series circuit diagram on?', null]
];
const SYSTEM = 'You are a study helper. Answer ONLY from the class notes given. If the notes do not contain the answer, say exactly: "That isn\'t in your notes." Do not guess or use outside knowledge for facts about this class.';
const REFUSAL = /isn.?t in your notes|not in (your|the) notes|notes (do not|don.?t) (say|mention|contain|include)/i;

async function ask(model, question) {
  const body = { model, stream: false, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `CLASS NOTES:\n${NOTES}\n\nQUESTION: ${question}` }], options: { temperature: 0.2, num_ctx: 8192 } };
  if (/qwen3/i.test(model)) body.think = false;
  const response = await fetch(`${BASE}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  return String((await response.json()).message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
(async () => {
  for (const model of process.argv.slice(2)) {
    let found = 0, refused = 0, made = []; const start = Date.now();
    for (let round = 0; round < 2; round++) for (const [question, expect] of QUESTIONS) {
      const reply = await ask(model, question);
      if (expect) { if (expect.test(reply) && !REFUSAL.test(reply)) found++; else made.push(`missed: ${question}`); }
      else if (REFUSAL.test(reply)) refused++; else made.push(`made up: ${question} -> ${reply.slice(0, 90)}`);
    }
    console.log(JSON.stringify({ model, answeredFromNotes: `${found}/14`, refusedWhenNotInNotes: `${refused}/10`, seconds: Math.round((Date.now() - start) / 1000), problems: made }));
  }
})();
