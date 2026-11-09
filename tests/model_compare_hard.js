// Harder checks that match where NEXUS went wrong: multi-step problems with no choices, explaining a wrong answer,
// and following a rubric without inventing requirements. Usage: node tests/model_compare_hard.js model1 model2
const BASE = 'http://127.0.0.1:11434';
const PROBLEMS = [
  ['A toaster uses 900 W. Electricity costs 15 cents per kWh. It runs 20 minutes a day for 30 days. What is the cost in cents?', 135],
  ['Three 4-ohm resistors are in series with a 24 V battery. What is the current in amperes?', 2],
  ['Two 6-ohm resistors are in parallel. What is their total resistance in ohms?', 3],
  ['A motor uses 500 J of electrical energy and gives out 350 J of useful mechanical energy. What is its efficiency in percent?', 70],
  ['A 60 W bulb runs for 5 hours. How many kWh does it use? Give a decimal.', 0.3],
  ['An atom has 17 protons and 18 neutrons. What is its mass number?', 35],
  ['An oxygen atom has 8 protons. As the ion O2-, how many electrons does it have?', 10],
  ['How many atoms in total are in one molecule of C6H12O6?', 24],
  ['In 2H2 + O2 -> 2H2O, how many hydrogen atoms are on the product side?', 4],
  ['A lake sample has 0.004 g of mercury in 1000 g of water. What is the concentration in ppm?', 4],
  ['A toxin is 0.02 ppm in plankton and is 10 times more concentrated at each of the next 3 levels of the food chain. What is the concentration at the third level above plankton, in ppm?', 20],
  ['Light travels about 300000 km/s. Sunlight takes about 500 seconds to reach Earth. How far is the Sun, in millions of km?', 150],
  ['A star is 4.2 light-years away. How many years ago did the light we see now leave it? Give a decimal.', 4.2],
  ['Cross Bb x bb. What percentage of offspring are expected to show the recessive trait?', 50],
  ['Cross Bb x Bb. What percentage of offspring are expected to be homozygous dominant?', 25],
  ['A circuit has a 9 V battery and draws 0.5 A. What is the power in watts?', 4.5],
  ['A 2000 W heater and a 500 W TV run together for 3 hours. Total energy in kWh?', 7.5],
  ['A resistor has 3 A through it and 12 V across it. Find its resistance in ohms.', 4],
  ['A 10-ohm and a 15-ohm resistor are in series with a 50 V source. What is the voltage across the 15-ohm resistor, in volts?', 30],
  ['A fridge is 25% efficient and uses 800 J. How many joules are wasted?', 600]
];
const RUBRIC = `Science 9 lab report rubric.
Hypothesis (4 marks): 4 = testable if/then statement naming both variables; 2 = statement missing a variable.
Data (4 marks): 4 = table with units and a title, plus a correctly labelled graph; 2 = table only.
Conclusion (4 marks): 4 = states whether the hypothesis was supported, using numbers from the data, and one source of error; 2 = restates results.`;
const GUIDE_PROMPT = `Here is the rubric for a student's lab report:\n${RUBRIC}\nTell the student exactly what to do for full marks, criterion by criterion. Only use requirements that are in the rubric. Do not write the report for them.`;
const INVENTED = /\b(\d+\s*(-|to)?\s*\d*\s*pages?|double[- ]spaced|font|title page|references|bibliography|word count|\d+\s*words|cover page|APA|MLA)\b/i;
const MUST = [/if.*then|if\/then/i, /variable/i, /unit/i, /title/i, /graph/i, /hypothesis.*support|support.*hypothesis/i, /error/i];
const EXPLAIN_PROMPT = 'A student says: "In a parallel circuit, adding more bulbs makes each bulb dimmer, just like in series." Are they right? Explain in 3 sentences for a Grade 9 student.';

async function ask(model, prompt) {
  const body = { model, stream: false, messages: [{ role: 'user', content: prompt }], options: { temperature: 0.2, num_ctx: 4096 } };
  if (/qwen3/i.test(model)) body.think = false;
  const response = await fetch(`${BASE}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  return String((await response.json()).message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
const lastNumber = text => { const all = String(text).replace(/,(?=\d{3})/g, '').match(/-?\d+(\.\d+)?/g); return all ? Number(all[all.length - 1]) : NaN; };

(async () => {
  for (const model of process.argv.slice(2)) {
    await ask(model, 'Say OK.');
    const start = Date.now(); let right = 0; const wrong = [];
    for (const [problem, answer] of PROBLEMS) {
      const reply = await ask(model, `${problem}\nWork it out step by step, then end with a final line: ANSWER: <number only>.`);
      const final = (reply.match(/ANSWER:\s*\**\s*(-?[\d.,]+)/i) || [])[1];
      const value = final ? Number(final.replace(/,/g, '')) : lastNumber(reply);
      if (Math.abs(value - answer) < 0.011 * Math.max(1, Math.abs(answer))) right++; else wrong.push(`${problem.slice(0, 40)}… got ${value}, want ${answer}`);
    }
    const perProblem = (Date.now() - start) / 1000 / PROBLEMS.length;
    let invented = 0, covered = 0;
    for (let i = 0; i < 3; i++) { const guide = await ask(model, GUIDE_PROMPT); if (INVENTED.test(guide)) invented++; covered += MUST.filter(re => re.test(guide)).length; }
    const explanation = await ask(model, EXPLAIN_PROMPT);
    console.log(JSON.stringify({ model, problems: `${right}/${PROBLEMS.length}`, secondsPerProblem: +perProblem.toFixed(1), guideInventedRules: `${invented}/3`, guideCovered: `${covered}/${MUST.length * 3}`, wrong, explanation }));
  }
})();
