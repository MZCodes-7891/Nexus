// Alberta curriculum outcomes, as taught by the Calgary Board of Education. These are short summaries of the Alberta Program of Studies outcomes, written for steering practice questions, not the official wording.
const COURSES = {
  'ab-science-9': {
    name: 'Science 9 (Alberta, CBE)',
    exam: 'the Alberta Grade 9 Science Provincial Achievement Test (PAT)',
    units: [
      { code: 'A', title: 'Biological Diversity', keywords: ['biodiversity', 'biological diversity', 'species', 'variation', 'niche', 'symbiosis', 'mutualism', 'commensalism', 'parasitism', 'asexual', 'sexual reproduction', 'mitosis', 'meiosis', 'dna', 'gene', 'chromosome', 'dominant', 'recessive', 'inherited', 'extinction', 'extirpation', 'natural selection', 'artificial selection', 'selective breeding', 'genetic engineering', 'cloning', 'invasive', 'gene bank', 'binary fission', 'budding', 'spore', 'vegetative', 'zygote', 'gamete'], outcomes: [
        { code: 'A1', name: 'Diversity among and within species', text: 'Explain how biological diversity is seen among species and within a species (variation); describe niches, adaptations, and interdependence such as symbiosis (mutualism, commensalism, parasitism); explain how diversity helps species and ecosystems survive change; use ways of measuring and comparing diversity.' },
        { code: 'A2', name: 'Reproduction and heredity', text: 'Compare asexual reproduction (binary fission, budding, spores, vegetative reproduction) and sexual reproduction (gametes, fertilization, zygote), with their advantages and disadvantages; explain DNA, genes, and chromosomes; compare mitosis and meiosis; distinguish inherited and non-inherited characteristics, and dominant and recessive traits.' },
        { code: 'A3', name: 'Changes in diversity over time', text: 'Explain natural selection and how environmental factors cause changes in populations; distinguish extinction and extirpation, with causes; interpret evidence of past and present changes in species.' },
        { code: 'A4', name: 'Human impact on species', text: 'Describe artificial selection, selective breeding, genetic engineering, cloning, and gene banks, with benefits and risks; analyze how human actions such as habitat loss, monoculture, and invasive species affect species survival and variation, and weigh decisions about them.' }
      ] },
      { code: 'B', title: 'Matter and Chemical Change', keywords: ['matter', 'chemical change', 'physical change', 'whmis', 'element', 'compound', 'periodic table', 'atom', 'proton', 'neutron', 'electron', 'ion', 'ionic', 'molecular', 'covalent', 'reactant', 'product', 'conservation of mass', 'endothermic', 'exothermic', 'combustion', 'corrosion', 'catalyst', 'rate of reaction', 'chemical formula', 'mixture', 'pure substance', 'bohr'], outcomes: [
        { code: 'B1', name: 'Properties and safety', text: 'Describe materials by physical and chemical properties; tell physical from chemical changes using evidence; classify pure substances and mixtures; use WHMIS and safe lab practice.' },
        { code: 'B2', name: 'Atomic theory and the periodic table', text: 'Explain how atomic theory developed (Dalton, Thomson, Rutherford, Bohr); use the periodic table to find atomic number, mass, groups, periods, metals, non-metals, and ion charges; draw and interpret Bohr diagrams.' },
        { code: 'B3', name: 'Ionic and molecular compounds', text: 'Compare ionic and molecular compounds by properties; name compounds and write chemical formulas from names, including multivalent metals and polyatomic ions.' },
        { code: 'B4', name: 'Chemical reactions', text: 'Identify reactants and products; write word and balanced chemical equations; apply the law of conservation of mass; compare endothermic and exothermic reactions; explain factors that change the rate of a reaction, such as temperature, concentration, surface area, and catalysts.' }
      ] },
      { code: 'C', title: 'Environmental Chemistry', keywords: ['environmental chemistry', 'nutrient', 'fertilizer', 'acid', 'base', 'ph', 'neutral', 'organic', 'inorganic', 'ppm', 'concentration', 'dose', 'ld50', 'toxicity', 'biomagnification', 'bioaccumulation', 'biodegradation', 'dispersion', 'pesticide', 'herbicide', 'water quality', 'indicator', 'dissolved oxygen', 'acid rain', 'ozone', 'hazardous waste', 'pollutant', 'leaching'], outcomes: [
        { code: 'C1', name: 'Substances that help or harm', text: 'Describe substances living things need or that harm them, including nutrients, fertilizers, and pesticides; compare organic and inorganic substances; describe acids, bases, and pH, and how they are tested and neutralized.' },
        { code: 'C2', name: 'How harmful substances spread', text: 'Explain how substances move and change in the environment, including dispersion, dilution, leaching, biodegradation, and phytoremediation; explain bioaccumulation and biomagnification in food chains; interpret concentration in ppm and toxicity such as LD50.' },
        { code: 'C3', name: 'Monitoring air and water quality', text: 'Describe how air and water quality are measured, using chemical factors and biological indicators such as dissolved oxygen and indicator species; interpret monitoring data.' },
        { code: 'C4', name: 'Environmental issues and risk', text: 'Analyze local and global issues such as acid rain, ozone depletion, and hazardous waste; weigh the risks and benefits of using chemicals, and evaluate ways to reduce harm.' }
      ] },
      { code: 'D', title: 'Electrical Principles and Technologies', keywords: ['electric', 'electricity', 'circuit', 'series', 'parallel', 'current', 'voltage', 'resistance', 'ohm', 'ampere', 'volt', 'conductor', 'insulator', 'static', 'battery', 'cell', 'generator', 'motor', 'power', 'watt', 'kilowatt', 'efficiency', 'energy transformation', 'renewable', 'non-renewable', 'fuse', 'circuit breaker', 'electromagnet', 'thermocouple', 'solar cell'], outcomes: [
        { code: 'D1', name: 'Making and using electricity', text: 'Describe static and current electricity; explain how cells, batteries, generators, solar cells, and thermocouples produce electrical energy, and how motors and other devices change it into other forms; trace energy transformations.' },
        { code: 'D2', name: 'Circuits and Ohm\'s law', text: 'Build and interpret series and parallel circuits and circuit diagrams; compare conductors, insulators, and resistance; use Ohm\'s law (V = I × R) to find voltage, current, or resistance; explain fuses and breakers.' },
        { code: 'D3', name: 'Power, energy, and efficiency', text: 'Calculate power (P = I × V) and energy use (E = P × t, in joules or kilowatt-hours) and its cost; calculate and compare efficiency of devices, and explain ways to reduce waste.' },
        { code: 'D4', name: 'Electricity and the environment', text: 'Compare renewable and non-renewable ways of producing electricity; assess their benefits, limits, and environmental effects, and choices about using electricity responsibly.' }
      ] },
      { code: 'E', title: 'Space Exploration', keywords: ['space', 'astronomy', 'star', 'planet', 'solar system', 'galaxy', 'universe', 'constellation', 'telescope', 'light-year', 'light year', 'astronomical unit', 'spectroscope', 'spectrum', 'satellite', 'orbit', 'rocket', 'spacesuit', 'space station', 'gravity', 'nebula', 'supernova', 'black hole', 'red giant', 'white dwarf', 'parallax', 'triangulation', 'gps', 'space debris', 'big bang'], outcomes: [
        { code: 'E1', name: 'How we came to understand space', text: 'Describe how ideas about Earth and space developed with technology, from early astronomy and constellations to telescopes; explain the life cycle of stars, the parts of the solar system and universe, and distances such as astronomical units and light-years.' },
        { code: 'E2', name: 'Getting to space and staying alive', text: 'Explain the hazards of space travel and the technologies that solve them, such as rockets, spacesuits, life support, and space stations; describe what satellites do, including communication and GPS.' },
        { code: 'E3', name: 'Tools for studying space', text: 'Explain how optical and radio telescopes, spectroscopes, and other tools gather information; use triangulation and parallax to find distance and position; interpret star spectra.' },
        { code: 'E4', name: 'Issues in space exploration', text: 'Weigh the costs, benefits, and risks of space exploration, such as space debris and the use of resources, and the questions of ethics and ownership it raises.' }
      ] }
    ]
  }
};

const courseList = () => Object.entries(COURSES).map(([id, course]) => ({ id, name: course.name, units: course.units.map(unit => ({ code: unit.code, title: unit.title, outcomes: unit.outcomes.map(({ code, name }) => ({ code, name })) })) }));

// The unit the material most likely belongs to, from how many of its key words appear.
function matchUnit(courseId, text) {
  const course = COURSES[courseId];
  if (!course) return null;
  const lower = ` ${String(text || '').toLowerCase()} `;
  let best = null;
  for (const unit of course.units) {
    const score = unit.keywords.reduce((sum, word) => sum + Math.min(5, lower.split(word).length - 1), 0) + (lower.includes(unit.title.toLowerCase()) ? 25 : 0);
    if (!best || score > best.score) best = { unit, score };
  }
  return best && best.score >= 6 ? best.unit : null;
}

// Outcomes for a unit, narrowed to those that match the chosen topics when that is clear.
function outcomesFor(courseId, unitCode, topicText = '') {
  const course = COURSES[courseId];
  const unit = course?.units.find(item => item.code === unitCode);
  if (!unit) return [];
  const words = String(topicText || '').toLowerCase().match(/[a-z]{5,}/g) || [];
  if (!words.length) return unit.outcomes;
  const scored = unit.outcomes.map(outcome => ({ outcome, score: words.filter(word => outcome.text.toLowerCase().includes(word) || outcome.name.toLowerCase().includes(word)).length }));
  const top = Math.max(...scored.map(item => item.score));
  return top >= 2 ? scored.filter(item => item.score >= Math.max(2, top / 2)).map(item => item.outcome) : unit.outcomes;
}

// Directions that make questions test the curriculum outcomes the way the course's tests do.
function standardsPrompt(courseId, unitCode, topicText = '') {
  const course = COURSES[courseId];
  const unit = course?.units.find(item => item.code === unitCode);
  if (!unit) return '';
  const outcomes = outcomesFor(courseId, unitCode, topicText);
  return `This test is for a ${course.name} student, Unit ${unit.code}: ${unit.title}. Test these curriculum outcomes:\n${outcomes.map(item => `- ${item.code} ${item.name}: ${item.text}`).join('\n')}\nWrite questions like ${course.exam} and Calgary Board of Education unit tests: most are multiple choice built on a short scenario, experiment, data table, or real-life example, where the student must apply, interpret, predict, compare, or explain, not just recall a definition. Include some that ask which conclusion an observation supports, or what would happen if something changed. Wrong choices should be common misconceptions. Spread questions across the outcomes listed. Set each question's "topic" to its outcome code and name, such as "${outcomes[0].code} ${outcomes[0].name}".`;
}

module.exports = { COURSES, courseList, matchUnit, outcomesFor, standardsPrompt };
