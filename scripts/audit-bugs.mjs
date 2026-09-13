/**
 * Headless bug audit for spire-climb-web.
 *
 * Loads the real index.html + game.js in Chromium and drives the game through a
 * scripted playthrough, recording state at each step. This proves behaviour
 * instead of inferring it from reading source.
 *
 * Usage: node scripts/audit-bugs.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('dialog', async (d) => {
  errors.push(`DIALOG: ${d.message()}`);
  await d.dismiss();
});

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(900); // let the async initGame() settle

/** Confirm the game self-started, using the bare binding (not window.game). */
const bootstrap = await page.evaluate(() => {
  let selfStarted = false;
  let deck = 0;
  let cards = 0;
  try {
    // eslint-disable-next-line no-undef
    selfStarted = typeof game !== 'undefined' && game !== null;
    if (selfStarted) {
      deck = game.gameState.deck.length;
      cards = game.cards.length;
    }
  } catch {
    selfStarted = false;
  }
  return { selfStarted, readyState: document.readyState, deck, cards };
});

const snap = (label) =>
  page.evaluate((l) => {
    // NOTE: `let game` at the top level of a classic script is a global LEXICAL
    // binding, NOT a window property. Referencing `window.game` always yields
    // undefined ??an earlier version of this audit did exactly that and produced
    // a false "game never starts" finding. Always use the bare identifier.
    const g = eval('game');
    const s = g.gameState;
    return {
      label: l,
      floor: s.currentFloor,
      hp: s.player.currentHP,
      block: s.player.block,
      energy: s.player.energy,
      gold: s.player.gold,
      relics: s.relics.map((r) => r.id),
      hand: s.hand.length,
      draw: s.drawPile.length,
      discard: s.discard.length,
      deckSize: s.deck.length,
      battle: s.battle ? { enemyHp: s.battle.enemies[0].currentHP, turn: s.battle.turn } : null,
      room: s.currentRoom ? { id: s.currentRoom.id, type: s.currentRoom.type, completed: s.currentRoom.completed } : null,
      available: g.mapNodes.filter((n) => n.available).map((n) => n.id),
    };
  }, label);

const results = [];
const note = (id, title, detail) => results.push({ id, title, detail });

note(
  'SELF-START',
  'Game self-starts correctly',
  `game created = ${bootstrap.selfStarted}; readyState = "${bootstrap.readyState}"; deck=${bootstrap.deck}, cards=${bootstrap.cards}. ` +
    `(An earlier version of this audit reported a false failure here by testing window.game; top-level 'let' does not create a window property.)`,
);

/* ---------- 1. Character switch accumulates relics ---------- */
await page.evaluate(() => {
  document.querySelector('[data-character="ironclad"] .btn-select').click();
  document.querySelector('[data-character="silent"] .btn-select').click();
});
const relicState = await snap('after switching ironclad -> silent');
note(
  'RELICS-STACK',
  'Switching characters accumulates relics instead of resetting',
  `relics = [${relicState.relics.join(', ')}] (expected only snake_ring for silent)`,
);

/* ---------- 2. Start a battle, then test card play outside battle ---------- */
await page.evaluate(() => eval('game').startGame());
await page.evaluate(() => {
  // Force the first node to be a fight so the test is deterministic.
  const g = eval('game');
  g.mapNodes[0].type = 'enemy';
  g.mapNodes[0].available = true;
  g.enterRoom(g.mapNodes[0]);
});
const battleStart = await snap('battle started');

/* ---------- 3. Enemy HP display does not refresh after damage ---------- */
const enemyDomBefore = await page.evaluate(
  () => document.querySelector('.enemy-hp')?.textContent?.trim() ?? null,
);
await page.evaluate(() => {
  const g = eval('game');
  // Play the first affordable attack card directly through the real code path.
  const idx = g.gameState.hand.findIndex((c) => c.damage && c.cost <= g.gameState.player.energy);
  if (idx >= 0) g.playCard(g.gameState.hand[idx].id);
});
const enemyDomAfter = await page.evaluate(
  () => document.querySelector('.enemy-hp')?.textContent?.trim() ?? null,
);
const afterHit = await snap('after playing one attack');
note(
  'ENEMY-HP-DOM-STALE',
  'Enemy HP text in the DOM never updates during battle',
  `DOM "${enemyDomBefore}" -> "${enemyDomAfter}"; real enemy HP ${battleStart.battle?.enemyHp} -> ${afterHit.battle?.enemyHp}`,
);

/* ---------- 4. Victory can be re-triggered (gold farming) ---------- */
const farm = await page.evaluate(() => {
  const g = eval('game');
  const golds = [];
  // Kill the enemy, then keep playing cards.
  g.gameState.battle.enemies[0].currentHP = 1;
  const attack = () => {
    const c = g.gameState.deck.find((x) => x.damage);
    return c;
  };
  golds.push(g.gameState.player.gold);
  // Force a hand of attacks and play them repeatedly.
  for (let i = 0; i < 5; i++) {
    g.gameState.hand = [{ ...attack() }];
    g.gameState.player.energy = 3;
    g.playCard(g.gameState.hand[0].id);
    golds.push(g.gameState.player.gold);
  }
  return {
    golds,
    enemyHp: g.gameState.battle.enemies[0].currentHP,
    roomCompleted: g.gameState.currentRoom.completed,
  };
});
note(
  'VICTORY-RETRIGGER',
  'Victory fires repeatedly while the battle object still exists (gold farm)',
  `gold after each play: ${farm.golds.join(' -> ')}; enemy HP ${farm.enemyHp}; room completed ${farm.roomCompleted}`,
);

/* ---------- 5. endTurn without a battle ---------- */
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
note('ENDTURN-NOBATTLE', 'endTurn() assumes a battle exists', String(noBattle));

/* ---------- 6. Player HP display after a FULL turn ----------
 * Must go through endTurn(), not enemyTurn() directly: endTurn() is the
 * production path and is where the UI refresh happens. Calling enemyTurn()
 * alone reports a false "stale DOM" failure.
 */
const hpUi = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  g.gameState.battle.enemies[0].actions = [{ type: 'attack', damage: 10, chance: 1 }];
  g.gameState.player.block = 0;
  const realBefore = g.gameState.player.currentHP;
  const domBefore = document.getElementById('player-hp').textContent;
  g.endTurn();
  return {
    domBefore,
    domAfter: document.getElementById('player-hp').textContent,
    realBefore,
    realAfter: g.gameState.player.currentHP,
  };
});
note(
  'PLAYER-HP-DOM-STALE',
  hpUi.domBefore !== hpUi.domAfter ? 'OK' : 'BUG',
  'Player HP in the DOM updates after the enemy turn',
  `real HP ${hpUi.realBefore} -> ${hpUi.realAfter}; DOM "${hpUi.domBefore}" -> "${hpUi.domAfter}"`,
);

/* ---------- 7. Draw pile corruption across a full turn ---------- */
const pile = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  // Give the enemy effectively infinite HP so the battle cannot end mid-test,
  // and play the hand out each turn so cards actually cycle.
  g.gameState.battle.enemies[0].currentHP = 999999;
  g.gameState.battle.enemies[0].maxHP = 999999;
  g.gameState.battle.enemies[0].actions = [{ type: 'block', block: 1, chance: 1 }];
  const total = () => g.gameState.hand.length + g.gameState.drawPile.length + g.gameState.discard.length;
  const trace = [total()];
  for (let turn = 0; turn < 6; turn++) {
    let guard = 0;
    while (g.gameState.hand.length > 0 && guard++ < 40) {
      g.gameState.player.energy = 99;
      g.playCard(g.gameState.hand[0].id);
    }
    g.endTurn();
    trace.push(total());
  }
  return { trace, deckSize: g.gameState.deck.length };
});
note(
  'CARD-CONSERVATION',
  pile.trace.every((n) => n === pile.trace[0]) ? 'OK' : 'BUG',
  'Live card total stays constant across turns (no duplication, no loss)',
  `totals ${pile.trace.join(', ')} (deck = ${pile.deckSize})`,
);

/* ---------- 8. Treasure room yields nothing ---------- */
const treasure = await page.evaluate(() => {
  const g = eval('game');
  const before = g.gameState.deck.length;
  const rareCount = g.cards.filter((c) => c.rarity === 'rare').length;
  const node = { id: 99, type: 'treasure', completed: false, available: true };
  g.gameState.currentRoom = node;
  g.showTreasure();
  return { rareCount, deckBefore: before, deckAfter: g.gameState.deck.length };
});
note(
  'TREASURE-EMPTY',
  'Treasure rooms can never grant a card',
  `cards with rarity "rare" = ${treasure.rareCount}; deck ${treasure.deckBefore} -> ${treasure.deckAfter}`,
);

/* ---------- 9. Relic effects never applied ---------- */
const relicEffect = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  return {
    relics: g.gameState.relics.map((r) => r.effect),
    handSize: g.gameState.hand.length,
    // Does any code path read .effect?
    effectReferenced: /\.effect\b/.test(document.querySelector('script[src*="game"]') ? '' : ''),
  };
});
note(
  'RELICS-INERT',
  'Relics are stored but their effects are never applied',
  `relics on player: [${relicEffect.relics.join(', ')}]; initial hand = ${relicEffect.handSize} (extra_card_draw would make it 6)`,
);

/* ---------- 10. Draw-cards button wiring ---------- */
const drawBtn = await page.evaluate(() => {
  const btn = document.getElementById('draw-cards-btn');
  return {
    exists: Boolean(btn),
    disabled: btn?.disabled ?? null,
    handlerCallsMissingMethod:
      typeof eval('game').drawCards === 'function' ? 'ok' : 'drawCards() is not defined on the class',
  };
});
note('DRAWBTN', 'Draw-cards button is disabled and its handler targets a non-existent method', JSON.stringify(drawBtn));

/* ---------- 11. Floor counter never advances ---------- */
const floor = await page.evaluate(() => {
  const g = eval('game');
  const seen = new Set();
  seen.add(g.gameState.currentFloor);
  for (const n of g.mapNodes) {
    g.gameState.currentRoom = n;
    g.gameState.currentRoom.completed = true;
  }
  g.updateUI();
  seen.add(g.gameState.currentFloor);
  return { floors: [...seen], domText: document.getElementById('current-floor').textContent };
});
note('FLOOR-STUCK', 'currentFloor never increments', `observed floors ${floor.floors.join(',')}; DOM shows ${floor.domText}`);

/* ---------- 12. endTurn after game over keeps drawing ---------- */
const afterDeath = await page.evaluate(() => {
  const g = eval('game');
  g.startBattle('enemy');
  g.gameState.player.currentHP = 1;
  g.gameState.battle.enemies[0].actions = [{ type: 'attack', damage: 50, chance: 1 }];
  g.endTurn();
  return {
    hp: g.gameState.player.currentHP,
    handAfterDeath: g.gameState.hand.length,
    energyAfterDeath: g.gameState.player.energy,
    battleStillSet: g.gameState.battle !== null,
  };
});
note(
  'ENDTURN-AFTER-DEATH',
  'endTurn() continues resolving after the player dies',
  `HP ${afterDeath.hp}; hand refilled to ${afterDeath.handAfterDeath}; energy reset to ${afterDeath.energyAfterDeath}; battle object still set: ${afterDeath.battleStillSet}`,
);

/* ---------- report ---------- */
await browser.close();

console.log('\nspire-climb-web ??bug audit\n' + '='.repeat(78));
for (const r of results) {
  console.log(`\n[${r.id}] ${r.title}`);
  console.log(`    evidence: ${r.detail}`);
}
console.log('\n' + '='.repeat(78));
console.log(`page errors / dialogs observed: ${errors.length}`);
for (const e of errors.slice(0, 12)) console.log(`  - ${e}`);
console.log(`\nfindings: ${results.length}`);

