/**
 * Bug audit for the game in assets/game.js.
 *
 * Drives the real page in a headless browser and asserts behaviour, so every
 * finding is measured rather than inferred from reading source. Each check
 * rebuilds the state it needs, so one test cannot drain the deck and mislead the
 * next.
 *
 * Usage:
 *   python -m http.server 5173                       # serve this folder
 *   node scripts/audit-bugs.mjs http://localhost:5173
 *
 * Requires playwright (a dev tool, not a runtime dependency):
 *   npm i -D playwright && npx playwright install chromium
 *
 * CRITICAL: `game` is declared with `let` at the top level of a classic script.
 * That creates a global LEXICAL binding, not a window property, so `window.game`
 * is always undefined. Every access below goes through eval('game'). An earlier
 * version of this file tested window.game and produced a false "the game never
 * starts" finding.
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const dialogs = [];
page.on('pageerror', (e) => dialogs.push(String(e).split('\n')[0]));
page.on('dialog', async (d) => {
  dialogs.push(`DIALOG: ${d.message()}`);
  await d.dismiss();
});

await page.goto(`${base}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(900); // let the async initGame() settle

const results = [];
/** @param {'ok'|'bug'|'n/a'} status */
const check = (id, status, title, detail) => results.push({ id, status, title, detail });

/* -- 1. self-start ------------------------------------------------------- */
const boot = await page.evaluate(() => {
  const started = typeof game !== 'undefined' && game !== null;
  return {
    started,
    deck: started ? game.gameState.deck.length : 0,
    cards: started ? game.cards.length : 0,
  };
});
check(
  'SELF-START',
  boot.started ? 'ok' : 'bug',
  'Game self-starts on page load',
  `game created = ${boot.started}; deck = ${boot.deck}; cards loaded = ${boot.cards}`,
);

/* -- 2. card data comes from cards.json ---------------------------------- */
check(
  'CARD-DATA-LOADED',
  boot.cards > 4 ? 'ok' : 'bug',
  'cards.json is actually loaded (not a hardcoded 4-card subset)',
  `${boot.cards} cards loaded (cards.json defines 11)`,
);

/* -- 3. character switch resets relics ---------------------------------- */
const relics = await page.evaluate(() => {
  document.querySelector('[data-character="ironclad"] .btn-select').click();
  document.querySelector('[data-character="silent"] .btn-select').click();
  return eval('game').gameState.relics.map((r) => r.id);
});
check(
  'RELICS-STACK',
  relics.length <= 1 ? 'ok' : 'bug',
  'Switching characters resets relics instead of stacking them',
  `relics after ironclad -> silent: [${relics.join(', ')}]`,
);

/* -- 4. treasure room grants a card ------------------------------------- */
const treasure = await page.evaluate(() => {
  const g = eval('game');
  const rare = g.cards.filter((c) => c.rarity === 'rare').length;
  const before = g.gameState.deck.length;
  g.gameState.currentRoom = { id: 998, type: 'treasure', completed: false };
  g.showTreasure();
  return { rare, before, after: g.gameState.deck.length };
});
check(
  'TREASURE-EMPTY',
  treasure.after > treasure.before ? 'ok' : 'bug',
  'Treasure rooms grant a card',
  `${treasure.rare} rare cards in pool; deck ${treasure.before} -> ${treasure.after}`,
);

/* -- 5. victory settles exactly once ----------------------------------- */
const farm = await page.evaluate(() => {
  const g = eval('game');
  g.gameState.currentCharacter = 'ironclad';
  g.gameState.relics = [];
  g.generateMap();
  g.mapNodes[0].type = 'enemy';
  g.mapNodes[0].available = true;
  g.enterRoom(g.mapNodes[0]);
  g.gameState.battle.enemies[0].currentHP = 1;
  g.gameState.hand = [{ ...g.cards.find((c) => c.damage) }];
  g.gameState.player.energy = 99;
  g.playCard(g.gameState.hand[0].id);
  const overAfterKill = g.gameState.battle.over;
  const golds = [g.gameState.player.gold];
  for (let i = 0; i < 5; i++) {
    g.gameState.hand = [{ ...g.cards.find((c) => c.damage) }];
    g.gameState.player.energy = 99;
    g.playCard(g.gameState.hand[0].id);
    golds.push(g.gameState.player.gold);
  }
  return { golds, overAfterKill, unique: new Set(golds).size };
});
check(
  'VICTORY-RETRIGGER',
  farm.unique === 1 ? 'ok' : 'bug',
  'Victory settles once per battle (no gold farm)',
  `battle.over after kill = ${farm.overAfterKill}; gold across 6 plays: ${farm.golds.join(' -> ')}`,
);

/* -- 6. endTurn is safe with no battle --------------------------------- */
const noBattle = await page.evaluate(() => {
  const g = eval('game');
  g.gameState.battle = null;
  try {
    g.endTurn();
    return 'no throw';
  } catch (e) {
    return `THREW: ${String(e).split('\n')[0]}`;
  }
});
check(
  'ENDTURN-NOBATTLE',
  noBattle === 'no throw' ? 'ok' : 'bug',
  'endTurn() is safe when no battle is active',
  String(noBattle),
);

/* -- 7. enemy HP re-renders after a card ------------------------------- */
const enemyDom = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  const before = document.querySelector('.enemy-hp')?.textContent?.trim() ?? null;
  const realBefore = g.gameState.battle.enemies[0].currentHP;
  const i = g.gameState.hand.findIndex((c) => c.damage && c.cost <= g.gameState.player.energy);
  if (i >= 0) g.playCard(g.gameState.hand[i].id);
  return {
    before,
    after: document.querySelector('.enemy-hp')?.textContent?.trim() ?? null,
    realBefore,
    realAfter: g.gameState.battle.enemies[0].currentHP,
  };
});
check(
  'ENEMY-HP-DOM-STALE',
  enemyDom.before !== enemyDom.after ? 'ok' : 'bug',
  'Enemy HP in the DOM updates after playing a card',
  `DOM "${enemyDom.before}" -> "${enemyDom.after}"; real HP ${enemyDom.realBefore} -> ${enemyDom.realAfter}`,
);

/* -- 8. player HP re-renders after a full turn ------------------------- */
const playerDom = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  g.gameState.battle.enemies[0].actions = [{ type: 'attack', damage: 10, chance: 1 }];
  g.gameState.player.block = 0;
  const realBefore = g.gameState.player.currentHP;
  const domBefore = document.getElementById('player-hp').textContent;
  g.endTurn(); // production path: endTurn -> enemyTurn -> updateUI
  return {
    realBefore,
    realAfter: g.gameState.player.currentHP,
    domBefore,
    domAfter: document.getElementById('player-hp').textContent,
  };
});
check(
  'PLAYER-HP-DOM-STALE',
  playerDom.domBefore !== playerDom.domAfter ? 'ok' : 'bug',
  'Player HP in the DOM updates after the enemy turn',
  `real HP ${playerDom.realBefore} -> ${playerDom.realAfter}; DOM "${playerDom.domBefore}" -> "${playerDom.domAfter}"`,
);

/* -- 9. card conservation --------------------------------------------- */
const conservation = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  g.gameState.battle.enemies[0].currentHP = 999999;
  g.gameState.battle.enemies[0].maxHP = 999999;
  g.gameState.battle.enemies[0].actions = [{ type: 'block', block: 1, chance: 1 }];
  const total = () =>
    g.gameState.hand.length + g.gameState.drawPile.length + g.gameState.discard.length;
  const trace = [total()];
  for (let t = 0; t < 6; t++) {
    let guard = 0;
    while (g.gameState.hand.length > 0 && guard++ < 40) {
      g.gameState.player.energy = 99;
      g.playCard(g.gameState.hand[0].id);
    }
    g.endTurn();
    trace.push(total());
  }
  return { trace, deck: g.gameState.deck.length };
});
check(
  'CARD-CONSERVATION',
  conservation.trace.every((n) => n === conservation.trace[0]) ? 'ok' : 'bug',
  'Live card total stays constant across turns',
  `totals ${conservation.trace.join(', ')} (deck = ${conservation.deck})`,
);

/* -- 10. relic: extra card draw --------------------------------------- */
const relicDraw = await page.evaluate(() => {
  const g = eval('game');
  g.selectCharacter('silent'); // snake_ring
  g.startBattle('enemy');
  return {
    relics: g.gameState.relics.map((r) => r.effect),
    hand: g.gameState.hand.length,
    expected: g.cardsPerTurn(),
  };
});
check(
  'RELICS-INERT',
  !relicDraw.relics.includes('extra_card_draw')
    ? 'n/a'
    : relicDraw.hand === relicDraw.expected && relicDraw.hand > 5
      ? 'ok'
      : 'bug',
  'The extra_card_draw relic grants an extra card',
  `relics [${relicDraw.relics.join(', ')}]; initial hand = ${relicDraw.hand} (cardsPerTurn = ${relicDraw.expected})`,
);

/* -- 11. relic: heal after combat ------------------------------------ */
const relicHeal = await page.evaluate(() => {
  const g = eval('game');
  g.selectCharacter('ironclad'); // burning_blood
  g.generateMap();
  g.mapNodes[0].type = 'enemy';
  g.mapNodes[0].available = true;
  g.enterRoom(g.mapNodes[0]);
  g.gameState.player.currentHP = 40;
  g.gameState.battle.enemies[0].currentHP = 1;
  g.gameState.hand = [{ ...g.cards.find((c) => c.damage) }];
  g.gameState.player.energy = 99;
  g.playCard(g.gameState.hand[0].id);
  return { hp: g.gameState.player.currentHP, relics: g.gameState.relics.map((r) => r.effect) };
});
check(
  'RELIC-HEAL',
  relicHeal.hp > 40 ? 'ok' : 'bug',
  'The heal_after_combat relic restores HP on victory',
  `HP after winning at 40: ${relicHeal.hp} (expected 46 with burning_blood)`,
);

/* -- 12. draw button ------------------------------------------------- */
const drawBtn = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  // ensure the pile has cards so a successful draw is observable
  g.gameState.drawPile = [...g.gameState.deck];
  const btn = document.getElementById('draw-cards-btn');
  const before = g.gameState.hand.length;
  btn.click();
  return {
    disabled: btn.disabled,
    method: typeof g.drawExtraCard,
    before,
    after: g.gameState.hand.length,
    counter: document.getElementById('draws-left')?.textContent,
  };
});
check(
  'DRAWBTN',
  !drawBtn.disabled && drawBtn.method === 'function' && drawBtn.after === drawBtn.before + 1
    ? 'ok'
    : 'bug',
  'Draw-cards button actually draws a card',
  `disabled=${drawBtn.disabled}; drawExtraCard is ${drawBtn.method}; hand ${drawBtn.before} -> ${drawBtn.after}; counter=${drawBtn.counter}`,
);

/* -- 13. floor advances ---------------------------------------------- */
const floor = await page.evaluate(() => {
  const g = eval('game');
  const before = g.gameState.currentFloor;
  const nodesBefore = g.mapNodes.length;
  for (let i = 0; i < g.mapNodes.length - 1; i++) g.mapNodes[i].completed = true;
  const last = g.mapNodes[g.mapNodes.length - 1];
  last.available = true;
  g.gameState.currentRoom = last;
  g.victory();
  return new Promise((resolve) => {
    setTimeout(
      () =>
        resolve({
          before,
          after: g.gameState.currentFloor,
          nodesBefore,
          nodesAfter: g.mapNodes.length,
          dom: document.getElementById('current-floor').textContent,
        }),
      2400,
    );
  });
});
check(
  'FLOOR-STUCK',
  floor.after > floor.before ? 'ok' : 'bug',
  'currentFloor advances when the floor is cleared',
  `floor ${floor.before} -> ${floor.after}; map rebuilt (${floor.nodesBefore} -> ${floor.nodesAfter} nodes); DOM shows ${floor.dom}`,
);

/* -- 14. card effects that the data declares ------------------------- */
const effects = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  const enemy = g.gameState.battle.enemies[0];
  enemy.currentHP = 999999;
  enemy.maxHP = 999999;

  const out = {};
  // weak: bash should apply weak to the enemy
  const bash = { ...g.cards.find((c) => c.id === 'bash') };
  g.gameState.player.energy = 99;
  g.gameState.hand = [bash];
  g.playCard('bash');
  out.weakApplied = (enemy.weak ?? 0) > 0;

  // block-scaling: body_slam damage equals current block
  g.gameState.player.block = 17;
  const slam = { ...g.cards.find((c) => c.id === 'body_slam') };
  g.gameState.hand = [slam];
  const hpBefore = enemy.currentHP;
  g.playCard('body_slam');
  out.slamDamage = hpBefore - enemy.currentHP;

  // addToDiscard: anger puts itself in discard AND adds a copy -> 2 entries
  const anger = { ...g.cards.find((c) => c.id === 'anger') };
  g.gameState.discard = [];
  g.gameState.hand = [anger];
  g.playCard('anger');
  out.angerIds = g.gameState.discard.map((c) => c.id);

  // clash is only playable when the hand is all attacks
  g.gameState.hand = [{ ...g.cards.find((c) => c.id === 'clash') }, { ...g.cards.find((c) => c.id === 'defend') }];
  out.clashBlocked = g.canPlayCard(g.gameState.hand[0]) === false;
  g.gameState.hand = [{ ...g.cards.find((c) => c.id === 'clash') }];
  out.clashAllowed = g.canPlayCard(g.gameState.hand[0]) === true;

  return out;
});
check(
  'CARD-EFFECTS',
  effects.weakApplied &&
    effects.slamDamage === 17 &&
    effects.angerIds.length === 2 &&
    effects.angerIds.every((id) => id === 'anger') &&
    effects.clashBlocked &&
    effects.clashAllowed
    ? 'ok'
    : 'bug',
  'Declared card effects are implemented',
  `weak applied=${effects.weakApplied}; body_slam dealt ${effects.slamDamage} (expected 17); anger discard=[${effects.angerIds.join(', ')}] (expected the played card plus one copy); clash blocked with skills=${effects.clashBlocked}, allowed alone=${effects.clashAllowed}`,
);

await browser.close();

/* -------------------------------- report ------------------------------- */
results.sort((a, b) => (a.status === b.status ? 0 : a.status === 'bug' ? -1 : 1));
console.log('\nspire-climb-web — bug audit\n' + '='.repeat(78));
for (const r of results) {
  console.log(`\n[${r.status.toUpperCase().padEnd(3)}] ${r.id} — ${r.title}`);
  console.log(`        ${r.detail}`);
}
const bugs = results.filter((r) => r.status === 'bug').length;
console.log('\n' + '='.repeat(78));
console.log(`checks: ${results.length}   failing: ${bugs}`);
console.log(`dialogs / page errors: ${dialogs.length}`);
for (const d of dialogs.slice(0, 8)) console.log(`  - ${d}`);
process.exit(bugs === 0 ? 0 : 1);
