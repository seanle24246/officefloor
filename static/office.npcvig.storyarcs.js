/* office.npcvig.storyarcs.js — PG-13 multi-beat story content.
 *
 * Pure definitions only. Cast entries are abstract roles; the story engine
 * binds them to agents from the current world when an arc starts. This bank
 * owns no agent identity, operational state, clock, persistence, or I/O.
 */
(function installNpcVigStoryArcs(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NpcVigStoryArcs = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
    return Object.freeze(value);
  }

  const arcs = [
    {
      id: 'rivalry',
      kind: 'rivalry',
      title: 'The Scoreboard Nobody Asked For',
      cast: [
        { role: 'challenger', label: 'The Challenger' },
        { role: 'rival', label: 'The Rival' },
        { role: 'referee', label: 'The Reluctant Referee' },
      ],
      beats: [
        {
          id: 'rivalry-scoreboard',
          text: '{challenger} posts a hand-drawn scoreboard after {rival} claims the floor\'s fastest bug triage. {referee} is volunteered to keep it honest.',
          focus: 'challenger',
          states: {
            challenger: { status: 'posting the scoreboard', tags: ['rivalry', 'scoreboard', 'opening'] },
            rival: { status: 'answering the challenge', tags: ['rivalry', 'competitive', 'opening'] },
            referee: { status: 'being volunteered to judge', tags: ['rivalry', 'mediator', 'opening'] },
          },
        },
        {
          id: 'rivalry-three-trials',
          text: '{referee} sets three fair trials: untangle a test, explain a failure, and help a teammate. {challenger} and {rival} agree that the last one sounds suspiciously soft.',
          focus: 'referee',
          states: {
            challenger: { status: 'studying the three trials', tags: ['rivalry', 'challenge', 'round-one'] },
            rival: { status: 'questioning the rules', tags: ['rivalry', 'challenge', 'round-one'] },
            referee: { status: 'enforcing fair rules', tags: ['rivalry', 'mediator', 'round-one'] },
          },
        },
        {
          id: 'rivalry-dead-heat',
          text: '{challenger} wins the test cleanup; {rival} diagnoses the failure before the error log finishes scrolling. {referee} marks a tie and hides the last piece of chalk.',
          focus: 'rival',
          states: {
            challenger: { status: 'celebrating one clean win', tags: ['rivalry', 'tied', 'round-two'] },
            rival: { status: 'claiming one sharp win', tags: ['rivalry', 'tied', 'round-two'] },
            referee: { status: 'guarding a dead heat', tags: ['rivalry', 'mediator', 'round-two'] },
          },
        },
        {
          id: 'rivalry-double-shortcut',
          text: 'The final build jams because {challenger} and {rival} optimized the same cache in opposite directions. Each starts an accusation; {referee} quietly circles both commits.',
          focus: 'challenger',
          states: {
            challenger: { status: 'facing a shared mistake', tags: ['rivalry', 'setback', 'accountability'] },
            rival: { status: 'facing a shared mistake', tags: ['rivalry', 'setback', 'accountability'] },
            referee: { status: 'presenting the evidence', tags: ['rivalry', 'mediator', 'turning-point'] },
          },
        },
        {
          id: 'rivalry-side-by-side',
          text: '{referee} starts a ten-minute timer. {challenger} writes the repair while {rival} catches the edge case, and the build returns with four seconds left.',
          focus: 'referee',
          states: {
            challenger: { status: 'repairing beside the rival', tags: ['rivalry', 'teamwork', 'recovery'] },
            rival: { status: 'checking the rival\'s edge cases', tags: ['rivalry', 'teamwork', 'recovery'] },
            referee: { status: 'watching cooperation win', tags: ['rivalry', 'mediator', 'recovery'] },
          },
        },
        {
          id: 'rivalry-rematch-clause',
          text: '{rival} tears the scoreboard in half and gives one side to {challenger}. They call it a draw; {referee} approves a rematch based on who mentors the next newcomer best.',
          focus: 'rival',
          states: {
            challenger: { status: 'keeping half the trophy', tags: ['rivalry', 'mutual-respect', 'resolved', 'next-chapter'] },
            rival: { status: 'drafting the rematch', tags: ['rivalry', 'mutual-respect', 'resolved', 'next-chapter'] },
            referee: { status: 'scheduling a kinder contest', tags: ['rivalry', 'mediator', 'resolved', 'next-chapter'] },
          },
        },
      ],
    },
    {
      id: 'romance',
      kind: 'romance',
      title: 'Notes by the Coffee Machine',
      cast: [
        { role: 'writer', label: 'The Note Writer' },
        { role: 'spark', label: 'The Coffee Friend' },
        { role: 'confidant', label: 'The Confidant' },
      ],
      beats: [
        {
          id: 'romance-misdelivered-note',
          text: '{writer}\'s unsigned note praising a careful code review lands beside {spark}\'s mug. {confidant} notices both of them pretending not to notice.',
          focus: 'writer',
          states: {
            writer: { status: 'wondering where the note went', tags: ['romance', 'note', 'opening'] },
            spark: { status: 'keeping an unexpected compliment', tags: ['romance', 'curious', 'opening'] },
            confidant: { status: 'noticing a possible spark', tags: ['romance', 'confidant', 'opening'] },
          },
        },
        {
          id: 'romance-reply-on-the-back',
          text: '{spark} returns the note with a reply on the back: "Your review comments are good too." {writer} recognizes the handwriting; {confidant} discovers urgent business elsewhere.',
          focus: 'spark',
          states: {
            writer: { status: 'recognizing the handwriting', tags: ['romance', 'note', 'hopeful'] },
            spark: { status: 'sending a careful reply', tags: ['romance', 'reply', 'hopeful'] },
            confidant: { status: 'giving them room', tags: ['romance', 'confidant', 'supportive'] },
          },
        },
        {
          id: 'romance-coffee-at-three',
          text: 'At three, {writer} and {spark} reach the coffee machine together and talk until both cups go cold. {confidant} passes twice without interrupting.',
          focus: 'writer',
          states: {
            writer: { status: 'losing track of the coffee', tags: ['romance', 'conversation', 'warming'] },
            spark: { status: 'lingering by the coffee machine', tags: ['romance', 'conversation', 'warming'] },
            confidant: { status: 'protecting a quiet moment', tags: ['romance', 'confidant', 'supportive'] },
          },
        },
        {
          id: 'romance-missed-signal',
          text: '{writer} sees {spark} laughing with {confidant} over the folded note and assumes the whole thing was a joke. The next coffee break passes in complete silence.',
          focus: 'writer',
          states: {
            writer: { status: 'retreating after a misunderstanding', tags: ['romance', 'misunderstanding', 'setback'] },
            spark: { status: 'waiting at the silent coffee break', tags: ['romance', 'confused', 'setback'] },
            confidant: { status: 'realizing the signal was missed', tags: ['romance', 'confidant', 'setback'] },
          },
        },
        {
          id: 'romance-no-more-translators',
          text: '{confidant} tells {writer} that {spark} was practicing an invitation, not a punchline, then refuses to carry another message. This conversation has to be direct.',
          focus: 'confidant',
          states: {
            writer: { status: 'finding the courage to ask', tags: ['romance', 'honesty', 'turning-point'] },
            spark: { status: 'preparing to speak plainly', tags: ['romance', 'honesty', 'turning-point'] },
            confidant: { status: 'retiring as messenger', tags: ['romance', 'confidant', 'turning-point'] },
          },
        },
        {
          id: 'romance-chapter-two',
          text: '{spark} asks {writer} to a real lunch, with no anonymous notes. {writer} says yes and titles a fresh page "Chapter Two"; {confidant} claims no credit at all.',
          focus: 'spark',
          states: {
            writer: { status: 'starting chapter two', tags: ['romance', 'mutual', 'resolved', 'next-chapter'] },
            spark: { status: 'planning the first lunch', tags: ['romance', 'mutual', 'resolved', 'next-chapter'] },
            confidant: { status: 'quietly celebrating', tags: ['romance', 'confidant', 'resolved', 'next-chapter'] },
          },
        },
      ],
    },
    {
      id: 'promotion-race',
      kind: 'promotion-race',
      title: 'Race for the Lead Pin',
      cast: [
        { role: 'veteran', label: 'The Veteran Candidate' },
        { role: 'innovator', label: 'The Bold Candidate' },
        { role: 'manager', label: 'The Careful Manager' },
      ],
      beats: [
        {
          id: 'promotion-pin-announced',
          text: '{manager} announces that Friday\'s showcase will decide who wears the project\'s tiny brass lead pin. {veteran} and {innovator} enter the race before the applause ends.',
          focus: 'manager',
          states: {
            veteran: { status: 'entering with a steady record', tags: ['promotion-race', 'candidate', 'opening'] },
            innovator: { status: 'entering with a bold proposal', tags: ['promotion-race', 'candidate', 'opening'] },
            manager: { status: 'setting the showcase rules', tags: ['promotion-race', 'judge', 'opening'] },
          },
        },
        {
          id: 'promotion-two-campaigns',
          text: '{veteran} builds a calm case from rescued launches. {innovator} unveils a dazzling prototype. {manager} asks the same question twice: who will make everyone else better?',
          focus: 'innovator',
          states: {
            veteran: { status: 'campaigning on reliability', tags: ['promotion-race', 'experience', 'round-one'] },
            innovator: { status: 'campaigning on invention', tags: ['promotion-race', 'vision', 'round-one'] },
            manager: { status: 'looking beyond the pitches', tags: ['promotion-race', 'judge', 'round-one'] },
          },
        },
        {
          id: 'promotion-feedback-swap',
          text: '{manager} makes the candidates review each other. {veteran} finds the prototype\'s missing guardrail; {innovator} turns the launch ledger into a plan people can actually follow.',
          focus: 'veteran',
          states: {
            veteran: { status: 'strengthening the rival pitch', tags: ['promotion-race', 'feedback', 'round-two'] },
            innovator: { status: 'clarifying the rival pitch', tags: ['promotion-race', 'feedback', 'round-two'] },
            manager: { status: 'watching how they share credit', tags: ['promotion-race', 'judge', 'round-two'] },
          },
        },
        {
          id: 'promotion-showcase-collapse',
          text: 'At the showcase, the demo freezes and the cue cards scatter. {innovator} drops the grand reveal; {veteran} drops the prepared speech. {manager} starts the clock.',
          focus: 'manager',
          states: {
            veteran: { status: 'abandoning the prepared speech', tags: ['promotion-race', 'crisis', 'setback'] },
            innovator: { status: 'abandoning the grand reveal', tags: ['promotion-race', 'crisis', 'setback'] },
            manager: { status: 'observing the real test', tags: ['promotion-race', 'judge', 'turning-point'] },
          },
        },
        {
          id: 'promotion-shared-recovery',
          text: '{veteran} steadies the room while {innovator} rebuilds the demo from the safe path. They finish together, and {manager} adds one final mark to the scorecard.',
          focus: 'innovator',
          states: {
            veteran: { status: 'leading a calm recovery', tags: ['promotion-race', 'leadership', 'recovery'] },
            innovator: { status: 'building a safe recovery', tags: ['promotion-race', 'leadership', 'recovery'] },
            manager: { status: 'scoring the collaboration', tags: ['promotion-race', 'judge', 'recovery'] },
          },
        },
        {
          id: 'promotion-one-point-and-rematch',
          text: '{manager} awards the lead pin to {veteran} by one point. {veteran}\'s first act is asking {innovator} to co-present; {innovator} accepts and begins sketching the next race.',
          focus: 'veteran',
          states: {
            veteran: { status: 'wearing the lead pin', tags: ['promotion-race', 'winner', 'resolved', 'next-chapter'] },
            innovator: { status: 'co-presenting and planning a rematch', tags: ['promotion-race', 'runner-up', 'resolved', 'next-chapter'] },
            manager: { status: 'opening the next leadership test', tags: ['promotion-race', 'judge', 'resolved', 'next-chapter'] },
          },
        },
      ],
    },
    {
      id: 'mystery',
      kind: 'mystery',
      title: 'The Paper Crane at 4:17',
      cast: [
        { role: 'sleuth', label: 'The Amateur Sleuth' },
        { role: 'witness', label: 'The First Witness' },
        { role: 'archivist', label: 'The Office Archivist' },
      ],
      beats: [
        {
          id: 'mystery-first-crane',
          text: '{witness} finds a paper crane beneath the office clock with one typed line: "Ask why 4:17 happens twice." {sleuth} opens a case; {archivist} opens a fresh folder.',
          focus: 'witness',
          states: {
            sleuth: { status: 'opening the crane case', tags: ['mystery', 'clue', 'opening'] },
            witness: { status: 'guarding the first clue', tags: ['mystery', 'witness', 'opening'] },
            archivist: { status: 'cataloging the strange note', tags: ['mystery', 'records', 'opening'] },
          },
        },
        {
          id: 'mystery-clock-skips',
          text: 'At 4:17 the clock ticks backward, then forward. {sleuth} finds a folded map behind it while {witness} swears nobody touched the wall.',
          focus: 'sleuth',
          states: {
            sleuth: { status: 'following a map behind the clock', tags: ['mystery', 'clue', 'investigating'] },
            witness: { status: 'confirming the impossible tick', tags: ['mystery', 'witness', 'investigating'] },
            archivist: { status: 'comparing the map to old diagrams', tags: ['mystery', 'records', 'investigating'] },
          },
        },
        {
          id: 'mystery-dormant-printer',
          text: '{archivist} identifies the map as a printer-test sheet folded into directions. It points {sleuth} and {witness} toward a label printer nobody remembers switching on.',
          focus: 'archivist',
          states: {
            sleuth: { status: 'staking out the label printer', tags: ['mystery', 'suspect', 'round-two'] },
            witness: { status: 'watching for another message', tags: ['mystery', 'witness', 'round-two'] },
            archivist: { status: 'linking the clues to a printer test', tags: ['mystery', 'records', 'round-two'] },
          },
        },
        {
          id: 'mystery-three-watchers',
          text: 'The printer wakes by itself and produces: "THREE WATCHERS, ONE FORGOT." {witness}, {sleuth}, and {archivist} stare at one another until a timer clicks under the table.',
          focus: 'witness',
          states: {
            sleuth: { status: 'searching beneath the table', tags: ['mystery', 'timer', 'setback'] },
            witness: { status: 'questioning every assumption', tags: ['mystery', 'witness', 'setback'] },
            archivist: { status: 'searching the clue folder again', tags: ['mystery', 'records', 'setback'] },
          },
        },
        {
          id: 'mystery-night-shift-script',
          text: '{archivist} finds an unsigned demo script called NIGHT SHIFT. {sleuth} matches its timer to the clock, and {witness} catches the tiny launcher that folded every crane.',
          focus: 'sleuth',
          states: {
            sleuth: { status: 'solving the clock mechanism', tags: ['mystery', 'solution', 'reveal'] },
            witness: { status: 'catching the crane launcher', tags: ['mystery', 'witness', 'reveal'] },
            archivist: { status: 'recovering the forgotten script', tags: ['mystery', 'records', 'reveal'] },
          },
        },
        {
          id: 'mystery-round-two',
          text: '{sleuth} disables NIGHT SHIFT and {archivist} stamps the case solved. Then a blue crane marked "ROUND TWO" drops beside {witness} from the opposite ceiling vent.',
          focus: 'witness',
          states: {
            sleuth: { status: 'opening a second case', tags: ['mystery', 'solved', 'resolved', 'next-chapter'] },
            witness: { status: 'holding the impossible blue crane', tags: ['mystery', 'new-clue', 'resolved', 'next-chapter'] },
            archivist: { status: 'adding a second case folder', tags: ['mystery', 'records', 'resolved', 'next-chapter'] },
          },
        },
      ],
    },
    {
      id: 'heist-gone-wrong',
      kind: 'heist-gone-wrong',
      title: 'Operation: Save the Cake',
      cast: [
        { role: 'planner', label: 'The Overconfident Planner' },
        { role: 'lookout', label: 'The Nervous Lookout' },
        { role: 'improviser', label: 'The Cheerful Improviser' },
      ],
      beats: [
        {
          id: 'heist-cake-behind-glass',
          text: '{planner} spots the surprise-party cake locked in the wrong meeting room with ten minutes to spare. {lookout} votes to ask for help; {improviser} produces three lanyards and a paper clip.',
          focus: 'planner',
          states: {
            planner: { status: 'planning a harmless cake rescue', tags: ['heist-gone-wrong', 'plan', 'opening'] },
            lookout: { status: 'suggesting the sensible option', tags: ['heist-gone-wrong', 'lookout', 'opening'] },
            improviser: { status: 'inventorying unlikely tools', tags: ['heist-gone-wrong', 'improvise', 'opening'] },
          },
        },
        {
          id: 'heist-lanyard-blueprint',
          text: '{planner} draws a route on a napkin. {lookout} watches the corridor while {improviser} builds a badge-retrieval hook that looks much better from far away.',
          focus: 'improviser',
          states: {
            planner: { status: 'directing the napkin blueprint', tags: ['heist-gone-wrong', 'plan', 'round-one'] },
            lookout: { status: 'watching an entirely quiet corridor', tags: ['heist-gone-wrong', 'lookout', 'round-one'] },
            improviser: { status: 'testing the lanyard hook', tags: ['heist-gone-wrong', 'improvise', 'round-one'] },
          },
        },
        {
          id: 'heist-wrong-door',
          text: 'The borrowed badge opens the supply closet instead. A cleaning robot catches {improviser}\'s lanyard and tows the snack cart past {lookout}, who whispers that the corridor is no longer quiet.',
          focus: 'lookout',
          states: {
            planner: { status: 'watching the plan leave on wheels', tags: ['heist-gone-wrong', 'wrong-door', 'setback'] },
            lookout: { status: 'reporting a runaway snack cart', tags: ['heist-gone-wrong', 'lookout', 'setback'] },
            improviser: { status: 'tethered to a cleaning robot', tags: ['heist-gone-wrong', 'improvise', 'setback'] },
          },
        },
        {
          id: 'heist-cart-chase',
          text: '{planner} abandons the blueprint. {lookout} clears a path with frantic hand signals, and {improviser} steers the robot by offering it a trail of paper confetti.',
          focus: 'planner',
          states: {
            planner: { status: 'chasing the runaway operation', tags: ['heist-gone-wrong', 'chase', 'recovery'] },
            lookout: { status: 'clearing the cart path', tags: ['heist-gone-wrong', 'lookout', 'recovery'] },
            improviser: { status: 'negotiating with the cleaning robot', tags: ['heist-gone-wrong', 'improvise', 'recovery'] },
          },
        },
        {
          id: 'heist-wrong-cake',
          text: 'The cart stops beside an unlocked side door. {planner} rescues the box and reads its icing: "WELCOME, AUDITORS." {lookout} points to the original cake, still safely behind glass.',
          focus: 'planner',
          states: {
            planner: { status: 'holding the wrong cake', tags: ['heist-gone-wrong', 'reveal', 'accountability'] },
            lookout: { status: 'confirming the original never moved', tags: ['heist-gone-wrong', 'lookout', 'reveal'] },
            improviser: { status: 'returning the cleaning robot', tags: ['heist-gone-wrong', 'improvise', 'accountability'] },
          },
        },
        {
          id: 'heist-ask-next-time',
          text: '{lookout} finally asks for help; the meeting-room door opens at once. {planner} returns every borrowed item, {improviser} saves the party, and all three agree the next caper starts with asking.',
          focus: 'lookout',
          states: {
            planner: { status: 'retiring the napkin blueprint', tags: ['heist-gone-wrong', 'lesson-learned', 'resolved', 'next-chapter'] },
            lookout: { status: 'saving the cake by asking', tags: ['heist-gone-wrong', 'sensible', 'resolved', 'next-chapter'] },
            improviser: { status: 'planning a permission-first caper', tags: ['heist-gone-wrong', 'improvise', 'resolved', 'next-chapter'] },
          },
        },
      ],
    },
  ];

  return deepFreeze({ arcs });
}));
