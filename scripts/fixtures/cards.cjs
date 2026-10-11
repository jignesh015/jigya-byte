const sampleSource = {
  sourceName: 'Test fixture',
  sourceUrl: null,
  attribution: 'Original sample content written for JigyaByte.',
  license: 'Original sample content',
  licenseUrl: null,
  retrievedAt: null,
};

const fixtureCards = [
  {
    ...sampleSource,
    id: 'fixture-feedback-loops', providerId: 'test-fixture', primaryTopicId: 'game-design', topicIds: ['game-design'],
    title: 'Why do feedback loops make games satisfying?',
    summary: 'A clear action, a visible result, and a useful next choice make players feel in control.',
    explanation: 'A feedback loop connects what a player does to what the game shows next. When the result is readable and arrives quickly, players can connect cause and effect, adjust their approach, and feel that their decisions matter. A loop can reward success, signal a mistake, or reveal a new possibility.',
  },
  {
    ...sampleSource,
    id: 'fixture-inertia', providerId: 'test-fixture', primaryTopicId: 'science', topicIds: ['science'],
    title: 'What does inertia explain?',
    summary: 'Objects keep their motion unless an outside force changes it.',
    explanation: 'Inertia is the tendency of matter to resist a change in motion. A book stays at rest until something pushes it; a rolling ball slows when friction acts on it. The idea helps explain why a sudden stop makes passengers lean forward: their bodies were still moving with the vehicle.',
  },
  {
    ...sampleSource,
    id: 'fixture-printing-press', providerId: 'test-fixture', primaryTopicId: 'history', topicIds: ['history', 'technology'],
    title: 'How did movable type change printing?',
    summary: 'Reusable letters made it practical to print many copies of a text.',
    explanation: 'With movable type, printers arranged individual characters into a page, printed it, then reused those characters for another page. The process took skilled labor, but it made repeated copies faster than copying each book by hand. Printing helped ideas travel farther and more consistently.',
  },
  {
    ...sampleSource,
    id: 'fixture-monsoon', providerId: 'test-fixture', primaryTopicId: 'geography', topicIds: ['geography', 'science'],
    title: 'Why do monsoon winds change direction?',
    summary: 'Land and ocean warm at different speeds as the seasons change.',
    explanation: 'Land heats and cools faster than the sea. In summer, warmer air over land rises and draws moist air inland from the ocean, bringing rain to many regions. In winter, the temperature pattern reverses and winds often flow back toward the sea.',
  },
  {
    ...sampleSource,
    id: 'fixture-night-sky', providerId: 'test-fixture', primaryTopicId: 'space', topicIds: ['space', 'science'],
    title: 'Why is the night sky dark?',
    summary: 'The universe has a finite age, and expansion stretches distant light.',
    explanation: 'Light from faraway galaxies has to travel for billions of years to reach us. The universe is about 13.8 billion years old, so there are regions whose light has not had time to reach Earth. Expansion also stretches ancient light to wavelengths beyond what our eyes can see.',
  },
  {
    ...sampleSource,
    id: 'fixture-opportunity-cost', providerId: 'test-fixture', primaryTopicId: 'economics', topicIds: ['economics'],
    title: 'What is opportunity cost?',
    summary: 'Choosing one option means giving up the value of the next best alternative.',
    explanation: 'Opportunity cost is the value of the best alternative you do not choose. If you spend an evening studying instead of working a paid shift, the foregone pay is part of the cost of studying. Thinking this way helps compare choices that use the same limited time or resources.',
  },
  {
    ...sampleSource,
    id: 'fixture-spacing-effect', providerId: 'test-fixture', primaryTopicId: 'psychology', topicIds: ['psychology'],
    title: 'Why can spaced practice help memory?',
    summary: 'Returning to an idea after a gap makes retrieval do useful work.',
    explanation: 'When you try to recall something after some time has passed, you strengthen the path to that memory. The effort of retrieving an idea can make it easier to retrieve later. Short review sessions spaced over time often support longer-lasting learning than one concentrated session.',
  },
  {
    ...sampleSource,
    id: 'fixture-error-correction', providerId: 'test-fixture', primaryTopicId: 'technology', topicIds: ['technology'],
    title: 'How does error correction protect data?',
    summary: 'Extra information lets a receiver detect or repair some mistakes.',
    explanation: 'A sender can add carefully chosen redundant bits to a message. When the receiver checks those bits, some corrupted data can be detected and, with suitable codes, corrected. This helps digital storage and communication remain reliable even when a few bits change.',
  },
  {
    ...sampleSource,
    id: 'fixture-thought-experiment', providerId: 'test-fixture', primaryTopicId: 'philosophy', topicIds: ['philosophy'],
    title: 'What can a thought experiment do?',
    summary: 'It tests an idea by imagining a carefully chosen situation.',
    explanation: 'A thought experiment asks what would follow if a particular scenario were true. By changing one feature at a time, it can expose assumptions, clarify a concept, or show that two beliefs conflict. It does not replace evidence about the real world, but it can sharpen the question we need evidence to answer.',
  },
  {
    ...sampleSource,
    id: 'fixture-cell-membrane', providerId: 'test-fixture', primaryTopicId: 'biology', topicIds: ['biology'],
    title: 'How does a cell membrane choose what passes?',
    summary: 'Its structure lets some substances cross more easily than others.',
    explanation: 'A cell membrane is made mainly of a double layer of molecules with water-friendly heads and water-avoiding tails. Small molecules can pass through more readily, while channels and carriers help selected substances cross. Cells use this selective boundary to maintain conditions needed for life.',
  },
];


module.exports = { fixtureCards };
