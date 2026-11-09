// Compares local models on 50 Grade 9 science questions with known answers, plus whether each can make a valid quiz
// question in the JSON shape NEXUS uses. Usage: node tests/model_compare.js qwen2.5:latest qwen3:14b
const QUESTIONS = [
  ['Which particle has a negative charge?', ['Proton', 'Neutron', 'Electron', 'Nucleus'], 'C'],
  ['The atomic number of an element tells you the number of…', ['Neutrons', 'Protons', 'Isotopes', 'Molecules'], 'B'],
  ['Which group of the periodic table contains the noble gases?', ['Group 1', 'Group 2', 'Group 17', 'Group 18'], 'D'],
  ['Sodium chloride is held together by which kind of bond?', ['Ionic', 'Covalent', 'Metallic', 'Hydrogen'], 'A'],
  ['Which of these is a chemical change?', ['Ice melting', 'Sugar dissolving', 'Iron rusting', 'Glass breaking'], 'C'],
  ['What is the chemical formula for water?', ['HO2', 'H2O', 'H2O2', 'OH'], 'B'],
  ['A substance with a pH of 3 is…', ['A strong base', 'Neutral', 'Acidic', 'Slightly basic'], 'C'],
  ['In a balanced chemical equation, what stays the same on both sides?', ['The number of molecules', 'The number of atoms of each element', 'The state of matter', 'The colour'], 'B'],
  ['Which scientist proposed the planetary model with a dense, positive nucleus?', ['Dalton', 'Thomson', 'Rutherford', 'Bohr'], 'C'],
  ['Elements in the same group have the same number of…', ['Valence electrons', 'Neutrons', 'Energy levels', 'Protons'], 'A'],
  ['What is the unit of electric current?', ['Volt', 'Ohm', 'Watt', 'Ampere'], 'D'],
  ['Ohm\'s law is…', ['V = I × R', 'P = V / I', 'R = V × I', 'I = V × R'], 'A'],
  ['A 12 V battery pushes 2 A through a resistor. What is the resistance?', ['24 Ω', '6 Ω', '10 Ω', '14 Ω'], 'B'],
  ['In a series circuit, if one bulb burns out…', ['The others get brighter', 'Only that bulb goes out', 'All the bulbs go out', 'The current doubles'], 'C'],
  ['Which material is the best electrical insulator?', ['Copper', 'Rubber', 'Aluminium', 'Salt water'], 'B'],
  ['Power used by a device is calculated by…', ['P = V × I', 'P = V / R', 'P = I / V', 'P = R × I'], 'A'],
  ['A 1500 W kettle runs for 2 hours. How much energy does it use?', ['750 kWh', '3 kWh', '1.5 kWh', '3000 kWh'], 'B'],
  ['A device that converts chemical energy to electrical energy is a…', ['Generator', 'Motor', 'Cell (battery)', 'Transformer'], 'C'],
  ['Efficiency is…', ['Input energy ÷ output energy', 'Useful output energy ÷ input energy × 100%', 'Power × time', 'Voltage ÷ current'], 'B'],
  ['Which energy source is renewable?', ['Coal', 'Natural gas', 'Wind', 'Oil'], 'C'],
  ['In a parallel circuit, the voltage across each branch is…', ['Split between branches', 'The same as the source', 'Zero', 'Doubled'], 'B'],
  ['Variation between members of the same species is called…', ['Interspecific variation', 'Intraspecific variation', 'Mutation', 'Extinction'], 'B'],
  ['Asexual reproduction produces offspring that are…', ['Genetically identical to the parent', 'Always stronger', 'Genetically unique', 'Sterile'], 'A'],
  ['Which form of reproduction gives more genetic variation?', ['Budding', 'Binary fission', 'Sexual reproduction', 'Vegetative propagation'], 'C'],
  ['DNA is found mainly in the cell\'s…', ['Cell membrane', 'Nucleus', 'Cytoplasm', 'Cell wall'], 'B'],
  ['A gene is…', ['A whole chromosome', 'A section of DNA that codes for a trait', 'A type of cell', 'A protein'], 'B'],
  ['An allele that shows up whenever it is present is…', ['Recessive', 'Dominant', 'Mutated', 'Incomplete'], 'B'],
  ['Choosing animals with desired traits to breed is called…', ['Natural selection', 'Artificial selection', 'Cloning', 'Extinction'], 'B'],
  ['A role an organism plays in its ecosystem is its…', ['Habitat', 'Niche', 'Population', 'Biome'], 'B'],
  ['Human cells (not sex cells) have how many chromosomes?', ['23', '46', '44', '92'], 'B'],
  ['A seed bank helps biodiversity by…', ['Storing seeds of many plant varieties for the future', 'Selling seeds', 'Making seeds grow faster', 'Removing invasive species'], 'A'],
  ['Which of these is an organic compound?', ['NaCl', 'H2O', 'C6H12O6', 'CO2'], 'C'],
  ['Biomagnification means a toxin…', ['Breaks down quickly', 'Becomes more concentrated higher in the food chain', 'Only affects plants', 'Turns into water'], 'B'],
  ['Which macronutrient is needed by plants and found in many fertilizers?', ['Nitrogen', 'Iron', 'Zinc', 'Copper'], 'A'],
  ['Acid rain is mainly caused by…', ['Oxygen and nitrogen gas', 'Sulfur dioxide and nitrogen oxides', 'Carbon monoxide', 'Ozone'], 'B'],
  ['A concentration of 5 ppm means…', ['5 parts per hundred', '5 parts per thousand', '5 parts per million', '5 parts per billion'], 'C'],
  ['Microorganisms breaking down a pollutant is called…', ['Biodegradation', 'Biomagnification', 'Bioaccumulation', 'Photosynthesis'], 'A'],
  ['An indicator species tells scientists about…', ['The age of rocks', 'The health of an environment', 'The weather tomorrow', 'Ocean depth'], 'B'],
  ['A pesticide used to kill weeds is a…', ['Herbicide', 'Insecticide', 'Fungicide', 'Fertilizer'], 'A'],
  ['Neutralizing an acidic lake is often done by adding…', ['Vinegar', 'Lime (calcium carbonate)', 'Sulfuric acid', 'Salt'], 'B'],
  ['A light-year measures…', ['Time', 'Distance', 'Brightness', 'Mass'], 'B'],
  ['The closest star to Earth is…', ['Proxima Centauri', 'Sirius', 'The Sun', 'Polaris'], 'C'],
  ['An astronomical unit (AU) is the average distance between…', ['Earth and the Moon', 'Earth and the Sun', 'The Sun and Pluto', 'Two galaxies'], 'B'],
  ['The Moon\'s phases are caused by…', ['Earth\'s shadow', 'The Moon changing shape', 'How much of the sunlit half we see', 'Clouds'], 'C'],
  ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 'B'],
  ['A star like our Sun will end its life as a…', ['Black hole', 'Neutron star', 'White dwarf', 'Supernova remnant only'], 'C'],
  ['Canadarm is famous because it…', ['Was the first satellite', 'Is a robotic arm used on the space shuttle and ISS', 'Landed on Mars', 'Is a telescope'], 'B'],
  ['Triangulation is used in astronomy to…', ['Measure the distance to objects', 'Find a star\'s colour', 'Weigh planets', 'Launch rockets'], 'A'],
  ['The Sun produces energy by…', ['Burning coal', 'Nuclear fusion', 'Nuclear fission', 'Chemical reactions with oxygen'], 'B'],
  ['A spectroscope splits light to show a star\'s…', ['Age only', 'Composition', 'Distance', 'Size only'], 'B']
];
const QUIZ_PROMPT = 'Write one multiple-choice question for Grade 9 science about series and parallel circuits. Reply with JSON only: {"question": string, "choices": [4 strings], "answer": "A"|"B"|"C"|"D", "explanation": string}.';
const BASE = 'http://127.0.0.1:11434';

async function ask(model, prompt, format) {
  const body = { model, stream: false, messages: [{ role: 'user', content: prompt }], options: { temperature: 0.2, num_ctx: 4096 } };
  if (/qwen3/i.test(model)) body.think = false;
  if (format) body.format = 'json';
  const response = await fetch(`${BASE}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  return String((await response.json()).message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function run(model) {
  await ask(model, 'Say OK.'); // load it first so timing is fair
  let right = 0; const wrong = []; const start = Date.now();
  for (const [question, choices, answer] of QUESTIONS) {
    const reply = await ask(model, `${question}\n${choices.map((choice, i) => `${'ABCD'[i]}. ${choice}`).join('\n')}\nReply with only the letter of the correct answer.`);
    const letter = (reply.match(/\b([ABCD])\b/) || [])[1];
    if (letter === answer) right++; else wrong.push(question.slice(0, 50));
  }
  const seconds = (Date.now() - start) / 1000;
  let validQuiz = 0;
  for (let i = 0; i < 5; i++) {
    try { const quiz = JSON.parse(await ask(model, QUIZ_PROMPT, true)); if (quiz.question && quiz.choices?.length === 4 && /^[ABCD]$/.test(quiz.answer) && quiz.explanation) validQuiz++; } catch {}
  }
  return { model, right, total: QUESTIONS.length, secondsPerAnswer: +(seconds / QUESTIONS.length).toFixed(2), validQuiz, wrong };
}

(async () => {
  const models = process.argv.slice(2);
  const results = [];
  for (const model of models) { const result = await run(model); results.push(result); console.log(JSON.stringify(result)); }
})();
