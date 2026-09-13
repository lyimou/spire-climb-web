// 游戏核心逻辑
class SlayTheSpireGame {
  constructor() {
    this.gameState = {
      currentFloor: 1,
      currentCharacter: null,
      player: {
        maxHP: 80,
        currentHP: 80,
        block: 0,
        energy: 3,
        maxEnergy: 3,
        gold: 100,
        potions: [],
      },
      map: [],
      currentRoom: null,
      battle: null,
      deck: [],
      hand: [],
      discard: [],
      drawPile: [],
      relics: [],
      potionSlots: 3,
      extraDrawsLeft: 5,
    };

    this.cards = [];
    this.enemies = [];
    this.relics = [];
    this.mapNodes = [];

    this.initGame();
  }

  async initGame() {
    await this.loadGameData();
    this.setupEventListeners();
    this.showStartScreen();

    // 初始化基础卡牌
    this.initBaseDeck();
  }
  async loadGameData() {
    // 卡牌数据来自 assets/data/cards.json。
    // 之前这里硬编码了 4 张牌的副本，导致 cards.json 里的 11 张牌（含 2 张稀有牌）
    // 从未被加载：宝藏房间筛 rare 永远为空，多种卡牌效果也无法生效。
    let loadedCards = null;
    try {
      const response = await fetch("assets/data/cards.json");
      if (response.ok) {
        loadedCards = await response.json();
      }
    } catch (error) {
      console.warn("cards.json 加载失败，使用内置基础牌组：", error);
    }

    // 兜底：即使 fetch 失败（例如以 file:// 直接打开），也要有可玩的牌组
    const fallbackCards = [
      {
        id: "strike",
        name: "打击",
        type: "attack",
        cost: 1,
        damage: 6,
        description: "造成6点伤害",
        rarity: "basic",
      },
      {
        id: "defend",
        name: "防御",
        type: "skill",
        cost: 1,
        block: 5,
        description: "获得5点格挡",
        rarity: "basic",
      },
    ];

    this.cards = Array.isArray(loadedCards) && loadedCards.length > 0 ? loadedCards : fallbackCards;

    this.enemies = [
      {
        id: "cultist",
        name: "邪教徒",
        maxHP: 50,
        currentHP: 50,
        intent: "ritual",
        damage: 6,
        description: "每回合强化自身",
        actions: [
          { type: "attack", damage: 6, chance: 0.7 },
          { type: "buff", strength: 3, chance: 0.3 },
        ],
      },
      {
        id: "jaw_worm",
        name: "颚虫",
        maxHP: 40,
        currentHP: 40,
        intent: "attack",
        damage: 5,
        description: "会防御的敌人",
        actions: [
          { type: "attack", damage: 8, chance: 0.5 },
          { type: "block", block: 5, chance: 0.5 },
        ],
      },
    ];

    this.relics = [
      {
        id: "burning_blood",
        name: "燃烧之血",
        description: "每场战斗结束时恢复6点生命",
        effect: "heal_after_combat",
        amount: 6,
      },
      {
        id: "snake_ring",
        name: "蛇之戒指",
        description: "每回合额外抽1张牌",
        effect: "extra_card_draw",
        amount: 1,
      },
      {
        id: "cracked_core",
        name: "裂变核心",
        description: "战斗开始时获得1点力量",
        effect: "strength_at_battle_start",
        amount: 1,
      },
    ];
  }

  /** 是否持有某个遗物。 */
  hasRelic(effect) {
    return this.gameState.relics.some((r) => r.effect === effect);
  }

  /** 取遗物的数值（默认 0）。 */
  relicAmount(effect) {
    const relic = this.gameState.relics.find((r) => r.effect === effect);
    return relic?.amount ?? 0;
  }

  setupEventListeners() {
    // 开始界面事件
    document.querySelectorAll(".btn-select").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const character = e.target.closest(".character-card").dataset.character;
        this.selectCharacter(character);
      });
    });

    document.getElementById("start-game-btn").addEventListener("click", () => {
      this.startGame();
    });

    // 控制按钮事件
    document.getElementById("end-turn-btn").addEventListener("click", () => {
      this.endTurn();
    });

    // 额外抽牌按钮：每回合最多 5 次，每次抽 1 张（原实现调用不存在的 drawCards()）
    document.getElementById("draw-cards-btn").addEventListener("click", () => {
      this.drawExtraCard();
    });

    // 设置按钮
    document.getElementById("settings-btn").addEventListener("click", () => {
      this.showModal("settings-modal");
    });

    document.getElementById("help-btn").addEventListener("click", () => {
      this.showModal("help-modal");
    });

    // 模态框关闭按钮
    document.querySelectorAll(".close-modal").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.hideAllModals();
      });
    });

    // 标签页切换
    document.querySelectorAll(".btn-tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        const tabId = e.target.closest(".btn-tab").id.replace("-btn", "-view");
        this.switchView(tabId);
      });
    });

    // 卡牌点击事件
    document.addEventListener("click", (e) => {
      const cardElement = e.target.closest(".card");
      if (cardElement && !cardElement.classList.contains("unplayable")) {
        const cardId = cardElement.dataset.cardId;
        this.playCard(cardId);
      }
    });
  }

  showStartScreen() {
    document.getElementById("start-screen").classList.add("active");
  }

  selectCharacter(character) {
    // 移除之前的选择
    document.querySelectorAll(".character-card").forEach((card) => {
      card.classList.remove("selected");
    });

    // 添加当前选择
    const selectedCard = document.querySelector(
      `[data-character="${character}"]`,
    );
    selectedCard.classList.add("selected");

    // 更新角色
    this.gameState.currentCharacter = character;

    // 切角色必须重置换装，否则反复切换会把各角色的初始遗物全部叠加上身
    this.gameState.relics = [];

    // 根据角色设置初始属性
    switch (character) {
      case "ironclad":
        this.gameState.player.maxHP = 80;
        this.gameState.player.currentHP = 80;
        this.gameState.player.energy = 3;
        this.gameState.player.maxEnergy = 3;
        this.addRelic("burning_blood");
        break;
      case "silent":
        this.gameState.player.maxHP = 70;
        this.gameState.player.currentHP = 70;
        this.gameState.player.energy = 3;
        this.gameState.player.maxEnergy = 3;
        this.addRelic("snake_ring");
        break;
      case "defect":
        this.gameState.player.maxHP = 75;
        this.gameState.player.currentHP = 75;
        this.gameState.player.energy = 3;
        this.gameState.player.maxEnergy = 3;
        // 原本故障机器人没有任何初始遗物，是三个角色里唯一空手的
        this.addRelic("cracked_core");
        break;
    }

    this.updateUI();
  }

  startGame() {
    if (!this.gameState.currentCharacter) {
      alert("请先选择一个角色！");
      return;
    }

    document.getElementById("start-screen").classList.remove("active");
    this.generateMap();
    this.switchView("map-view");
    this.updateUI();
  }

  generateMap() {
    this.mapNodes = [];

    // 生成简单的地图
    const nodeTypes = ["enemy", "enemy", "elite", "treasure", "shop", "rest"];

    for (let i = 0; i < 6; i++) {
      const nodeType = nodeTypes[Math.floor(Math.random() * nodeTypes.length)];
      this.mapNodes.push({
        id: i + 1,
        type: nodeType,
        completed: false,
        available: i === 0, // 第一个节点可用
        description: this.getNodeDescription(nodeType),
      });
    }

    // 添加BOSS节点
    this.mapNodes.push({
      id: 7,
      type: "boss",
      completed: false,
      available: false,
      description: "本层BOSS",
    });

    this.renderMap();
  }

  getNodeDescription(type) {
    const descriptions = {
      enemy: "普通敌人",
      elite: "精英敌人",
      treasure: "宝藏房间",
      shop: "商店",
      rest: "篝火",
      boss: "本层BOSS",
    };
    return descriptions[type] || "未知房间";
  }

  renderMap() {
    const mapGrid = document.getElementById("map-grid");
    mapGrid.innerHTML = "";

    this.mapNodes.forEach((node, index) => {
      const nodeElement = document.createElement("div");
      nodeElement.className = `map-node node-type ${node.type}`;
      if (node.completed) nodeElement.classList.add("completed");
      if (!node.available) nodeElement.classList.add("disabled");
      nodeElement.dataset.nodeId = node.id;

      const iconMap = {
        enemy: "fas fa-skull-crossbones",
        elite: "fas fa-crown",
        treasure: "fas fa-gem",
        shop: "fas fa-shopping-cart",
        rest: "fas fa-campfire",
        boss: "fas fa-dragon",
      };

      nodeElement.innerHTML = `
                <div class="node-icon">
                    <i class="${iconMap[node.type]}"></i>
                </div>
                <div class="node-title">节点 ${node.id}</div>
                <div class="node-desc">${node.description}</div>
                ${
                  node.type === "enemy" || node.type === "elite"
                    ? '<div class="node-reward">可能掉落：卡牌/金币</div>'
                    : ""
                }
            `;

      if (node.available) {
        nodeElement.addEventListener("click", () => this.enterRoom(node));
      }

      mapGrid.appendChild(nodeElement);
    });
  }

  enterRoom(node) {
    this.gameState.currentRoom = node;

    switch (node.type) {
      case "enemy":
      case "elite":
      case "boss":
        this.startBattle(node.type);
        break;
      case "treasure":
        this.showTreasure();
        break;
      case "shop":
        this.showShop();
        break;
      case "rest":
        this.showRest();
        break;
    }

    this.switchView("battle-view");
  }

  startBattle(enemyType) {
    const enemyTemplate =
      this.enemies[Math.floor(Math.random() * this.enemies.length)];
    this.gameState.battle = {
      enemies: [
        {
          ...enemyTemplate,
          currentHP: enemyTemplate.maxHP,
        },
      ],
      turn: "player",
      round: 1,
      // 战斗结算标志：没有它的话，敌人死后继续出牌会反复触发 victory()
      over: false,
    };

    this.gameState.extraDrawsLeft = SlayTheSpireGame.EXTRA_DRAWS_PER_TURN;
    this.updateDrawButton();

    // 每场战斗都要重新发牌。
    // 原实现只调用 shuffleDeck()，而它只打乱「现有抽牌堆」——如果上一场战斗
    // 把抽牌堆用光了，新战斗会以空抽牌堆 + 空手牌开始，直接无法出牌。
    this.gameState.drawPile = this.shuffleArray([...this.gameState.deck]);
    this.gameState.discard = [];
    this.gameState.hand = [];
    this.gameState.player.block = 0;

    this.drawInitialHand();
    this.updateBattleUI();
    this.addLog("战斗开始！");

    // 遗物：战斗开始时获得力量
    const openingStrength = this.relicAmount("strength_at_battle_start");
    if (openingStrength > 0) {
      this.gameState.player.strength = (this.gameState.player.strength ?? 0) + openingStrength;
      this.addLog(`遗物生效：获得 ${openingStrength} 点力量`);
    }
  }

  /**
   * Fisher-Yates shuffle of an array (in place).
   * Returns the same array so it can be used inline.
   */
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Shuffle the current draw pile.
   *
   * This must NOT rebuild from `deck`: `drawCard()` calls it right after moving
   * the discard pile into the draw pile, so rebuilding would discard those newly
   * recycled cards and duplicate the originals (the live card total drifted from
   * 9 up to 13 and then decayed to 11). See scripts/audit-bugs.mjs.
   */
  shuffleDeck() {
    this.shuffleArray(this.gameState.drawPile);
  }

  drawInitialHand() {
    this.gameState.hand = [];
    for (let i = 0; i < this.cardsPerTurn(); i++) {
      this.drawCard();
    }
    this.updateHandUI();
  }

  /** 每回合抽牌数：基础 5 张，加上遗物加成。 */
  cardsPerTurn() {
    return 5 + this.relicAmount("extra_card_draw");
  }

  drawCard() {
    if (this.gameState.drawPile.length === 0) {
      // 弃牌堆洗回抽牌堆，而不是用整副牌重建
      this.gameState.drawPile = this.shuffleArray([...this.gameState.discard]);
      this.gameState.discard = [];
    }

    if (this.gameState.drawPile.length > 0) {
      const card = this.gameState.drawPile.shift();
      this.gameState.hand.push(card);
    }

    this.updateHandUI();
  }

  playCard(cardId) {
    const cardIndex = this.gameState.hand.findIndex(
      (card) => card.id === cardId,
    );
    if (cardIndex === -1) return;

    const card = this.gameState.hand[cardIndex];

    // 检查能量
    if (this.gameState.player.energy < card.cost) {
      this.addLog("能量不足！");
      return;
    }

    // 检查卡牌自身的打出条件
    if (!this.canPlayCard(card)) {
      this.addLog(`${card.name} 现在无法打出`);
      return;
    }

    // 消耗能量
    this.gameState.player.energy -= card.cost;

    // 应用卡牌效果
    this.applyCardEffect(card);

    // 移除手牌
    this.gameState.hand.splice(cardIndex, 1);
    this.gameState.discard.push(card);

    this.updateUI();
    // 敌人血量在战斗界面上单独渲染，必须一并刷新，否则血条永远停在满血
    this.updateBattleUI();
    this.addLog(`使用了 ${card.name}`);
  }

  applyCardEffect(card) {
    const enemy = this.gameState.battle?.enemies?.[0];
    if (!enemy) return;

    // 全身撞击：伤害等于当前格挡值
    let damage = card.damage ?? 0;
    if (card.id === "body_slam") damage = this.gameState.player.block;
    // 力量加成对每次攻击生效
    if (this.gameState.player.strength) damage += this.gameState.player.strength;

    if (damage > 0) {
      const dealt = Math.max(0, damage - (enemy.block ?? 0));
      if (enemy.block) enemy.block = Math.max(0, enemy.block - damage);
      enemy.currentHP -= dealt;
      this.addLog(`对 ${enemy.name} 造成 ${dealt} 点伤害`);

      if (enemy.currentHP <= 0) {
        this.victory();
        return;
      }
    }

    if (card.block) {
      this.gameState.player.block += card.block;
      this.addLog(`获得了 ${card.block} 点格挡`);
    }

    // 虚弱：降低敌人下一回合的攻击力
    if (card.weak) {
      enemy.weak = (enemy.weak ?? 0) + card.weak;
      this.addLog(`${enemy.name} 获得 ${card.weak} 层虚弱`);
    }

    // 力量：每层让攻击 +1
    if (card.strength) {
      this.gameState.player.strength = (this.gameState.player.strength ?? 0) + card.strength;
      this.addLog(`获得 ${card.strength} 点力量`);
    }

    // 抽牌
    if (card.draw) {
      for (let i = 0; i < card.draw; i++) this.drawCard();
    }

    // 将一张副本加入弃牌堆（愤怒）
    if (card.addToDiscard) {
      const template = this.cards.find((c) => c.id === card.addToDiscard);
      if (template) this.gameState.discard.push({ ...template });
    }
  }

  /** 卡牌是否满足打出条件（冲突：手牌必须全是攻击牌）。 */
  canPlayCard(card) {
    if (card.id === "clash") {
      return this.gameState.hand.every((c) => c.type === "attack");
    }
    return true;
  }

  /** 每回合的额外抽牌次数上限。 */
  static EXTRA_DRAWS_PER_TURN = 5;

  drawExtraCard() {
    if (!this.gameState.battle || this.gameState.battle.over) return;
    if (this.gameState.extraDrawsLeft <= 0) {
      this.addLog("本回合的额外抽牌次数已用完");
      return;
    }
    this.gameState.extraDrawsLeft -= 1;
    this.drawCard();
    this.updateDrawButton();
  }

  /** 同步额外抽牌按钮的可用状态与剩余次数。 */
  updateDrawButton() {
    const btn = document.getElementById("draw-cards-btn");
    const counter = document.getElementById("draws-left");
    if (counter) counter.textContent = this.gameState.extraDrawsLeft;
    if (!btn) return;
    const usable =
      Boolean(this.gameState.battle) &&
      !this.gameState.battle.over &&
      this.gameState.extraDrawsLeft > 0;
    btn.disabled = !usable;
  }

  endTurn() {
    // 没有进行中的战斗时直接结束，否则会读 undefined.enemies 抛错
    if (!this.gameState.battle || this.gameState.battle.over) return;

    this.addLog("--- 回合结束 ---");

    // 敌人行动
    this.enemyTurn();

    // 敌人行动会改变玩家血量，必须刷新界面
    this.updateUI();

    // 玩家已阵亡：enemyTurn() 已触发 gameOver()，不要再继续结算
    if (this.gameState.battle.over) return;

    // 清理状态
    this.gameState.player.block = 0;
    this.gameState.player.energy = this.gameState.player.maxEnergy;
    this.gameState.extraDrawsLeft = SlayTheSpireGame.EXTRA_DRAWS_PER_TURN;
    this.updateDrawButton();

    // 弃掉手牌
    this.gameState.discard.push(...this.gameState.hand);
    this.gameState.hand = [];

    // 抽新牌（数量受遗物影响）
    for (let i = 0; i < this.cardsPerTurn(); i++) {
      this.drawCard();
    }

    this.updateUI();
  }

  enemyTurn() {
    const enemy = this.gameState.battle.enemies[0];

    // 简单AI：随机选择一个动作
    const action =
      enemy.actions[Math.floor(Math.random() * enemy.actions.length)];

    switch (action.type) {
      case "attack": {
        // 力量加成 + 虚弱扣减，两者都来自卡牌效果
        const strength = enemy.strength ?? 0;
        const weakPenalty = enemy.weak ? 0.75 : 1;
        const raw = Math.round((action.damage + strength) * weakPenalty);
        const blocked = Math.min(this.gameState.player.block, raw);
        const damage = Math.max(0, raw - blocked);
        this.gameState.player.currentHP -= damage;
        this.gameState.player.block = Math.max(0, this.gameState.player.block - raw);
        this.addLog(
          `${enemy.name} 攻击，造成 ${damage} 点伤害${blocked > 0 ? `（格挡 ${blocked}）` : ""}`,
        );
        break;
      }

      case "block":
        // 敌人获得格挡，之前的实现只写日志、不产生任何效果
        enemy.block = (enemy.block ?? 0) + (action.block ?? 0);
        this.addLog(`${enemy.name} 获得了 ${action.block ?? 0} 点格挡`);
        break;

      case "buff":
        enemy.strength = (enemy.strength ?? 0) + (action.strength ?? 0);
        this.addLog(`${enemy.name} 强化了自己（力量 +${action.strength ?? 0}）`);
        break;
    }

    // 虚弱在敌人行动后递减
    if (enemy.weak) enemy.weak = Math.max(0, enemy.weak - 1);

    // 检查玩家死亡
    if (this.gameState.player.currentHP <= 0) {
      this.gameOver();
    }
  }

  victory() {
    // 只结算一次：否则敌人死后每出一张牌都会再加一次金币
    if (this.gameState.battle?.over) return;
    if (this.gameState.battle) this.gameState.battle.over = true;

    this.addLog("战斗胜利！");
    this.gameState.currentRoom.completed = true;

    // 解锁下一个节点
    const currentIndex = this.mapNodes.findIndex(
      (node) => node.id === this.gameState.currentRoom.id,
    );
    if (currentIndex < this.mapNodes.length - 1) {
      this.mapNodes[currentIndex + 1].available = true;
    }

    // 奖励
    const goldReward =
      this.gameState.currentRoom.type === "elite"
        ? 25
        : this.gameState.currentRoom.type === "boss"
          ? 100
          : 10;

    this.gameState.player.gold += goldReward;
    this.addLog(`获得了 ${goldReward} 金币`);

    // 遗物：战斗结束后回血
    const heal = this.relicAmount("heal_after_combat");
    if (heal > 0) {
      const before = this.gameState.player.currentHP;
      this.gameState.player.currentHP = Math.min(
        this.gameState.player.maxHP,
        this.gameState.player.currentHP + heal,
      );
      const healed = this.gameState.player.currentHP - before;
      if (healed > 0) this.addLog(`遗物生效：恢复 ${healed} 点生命`);
    }

    // 回到地图，并检查本层是否已清空
    setTimeout(() => {
      this.checkFloorCleared();
      this.switchView("map-view");
      this.updateUI();
    }, 2000);
  }

  /** 所有节点完成后进入下一层。 */
  checkFloorCleared() {
    const allCleared = this.mapNodes.every((node) => node.completed);
    if (!allCleared) return;

    this.gameState.currentFloor += 1;
    this.addLog(`进入第 ${this.gameState.currentFloor} 层`);
    this.generateMap();
  }

  gameOver() {
    if (this.gameState.battle) this.gameState.battle.over = true;
    this.addLog("游戏结束！");
    alert("游戏结束！你被击败了。");
    this.showStartScreen();
  }

  addLog(message) {
    const logContainer = document.getElementById("battle-log");
    const logEntry = document.createElement("div");
    logEntry.className = "log-entry";
    logEntry.textContent = message;

    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  switchView(viewId) {
    // 隐藏所有视图
    document.querySelectorAll(".game-view").forEach((view) => {
      view.classList.remove("active");
    });

    // 移除所有标签激活状态
    document.querySelectorAll(".btn-tab").forEach((tab) => {
      tab.classList.remove("active");
    });

    // 显示目标视图
    const targetView = document.getElementById(viewId);
    if (targetView) {
      targetView.classList.add("active");

      // 激活对应的标签
      const targetTab = document.getElementById(
        viewId.replace("-view", "-btn"),
      );
      if (targetTab) {
        targetTab.classList.add("active");
      }
    }
  }

  showModal(modalId) {
    document.getElementById(modalId).classList.add("active");
  }

  hideAllModals() {
    document.querySelectorAll(".modal").forEach((modal) => {
      modal.classList.remove("active");
    });
  }

  updateUI() {
    // 更新玩家状态
    document.getElementById("player-hp").textContent =
      this.gameState.player.currentHP;
    document.getElementById("player-max-hp").textContent =
      this.gameState.player.maxHP;
    document.getElementById("player-energy").textContent =
      this.gameState.player.energy;
    document.getElementById("player-max-energy").textContent =
      this.gameState.player.maxEnergy;
    document.getElementById("player-block").textContent =
      this.gameState.player.block;
    document.getElementById("gold").textContent = this.gameState.player.gold;
    document.getElementById("potion-slots").textContent =
      `${this.gameState.player.potions.length}/3`;

    // 更新生命条
    const hpPercent =
      (this.gameState.player.currentHP / this.gameState.player.maxHP) * 100;
    document.getElementById("hp-fill").style.width = `${hpPercent}%`;

    // 更新当前楼层
    document.getElementById("current-floor").textContent =
      this.gameState.currentFloor;

    // 更新进度
    const completedCount = this.mapNodes.filter(
      (node) => node.completed,
    ).length;
    const totalCount = this.mapNodes.length;
    const progressPercent = (completedCount / totalCount) * 100;
    document.getElementById("floor-progress").style.width =
      `${progressPercent}%`;
  }

  updateBattleUI() {
    if (!this.gameState.battle) return;

    const enemyInfo = document.getElementById("enemy-info");
    enemyInfo.innerHTML = "";

    this.gameState.battle.enemies.forEach((enemy) => {
      const enemyElement = document.createElement("div");
      enemyElement.className = "enemy-card";
      enemyElement.innerHTML = `
                <div class="enemy-header">
                    <div class="enemy-name">${enemy.name}</div>
                    <div class="enemy-hp">${enemy.currentHP}/${enemy.maxHP}</div>
                </div>
                <div class="hp-bar">
                    <div class="hp-fill" style="width: ${(enemy.currentHP / enemy.maxHP) * 100}%"></div>
                </div>
                <div class="enemy-desc">${enemy.description}</div>
                <div class="enemy-intent">
                    <i class="fas ${enemy.intent === "attack" ? "fa-sword" : "fa-magic"} intent-icon"></i>
                    ${enemy.intent === "attack" ? "准备攻击" : "正在咏唱"}
                </div>
            `;
      enemyInfo.appendChild(enemyElement);
    });
  }

  updateHandUI() {
    const handCards = document.getElementById("hand-cards");
    handCards.innerHTML = "";

    this.gameState.hand.forEach((card) => {
      const cardElement = document.createElement("div");
      cardElement.className = `card ${card.type}`;
      if (this.gameState.player.energy < card.cost) {
        cardElement.classList.add("unplayable");
      }
      cardElement.dataset.cardId = card.id;

      cardElement.innerHTML = `
                <div class="card-energy">${card.cost}</div>
                <div class="card-title">${card.name}</div>
                <div class="card-desc">${card.description}</div>
                <div class="card-type ${card.type}">${this.getCardTypeName(card.type)}</div>
            `;

      handCards.appendChild(cardElement);
    });

    // 更新手牌数量
    document.getElementById("hand-count").textContent =
      this.gameState.hand.length;
    document.getElementById("deck-count").textContent =
      this.gameState.drawPile.length;
    document.getElementById("discard-count").textContent =
      this.gameState.discard.length;
  }

  getCardTypeName(type) {
    const typeNames = {
      attack: "攻击",
      skill: "技能",
      power: "能力",
    };
    return typeNames[type] || "未知";
  }

  addRelic(relicId) {
    const relic = this.relics.find((r) => r.id === relicId);
    if (relic) {
      this.gameState.relics.push(relic);
    }
  }

  initBaseDeck() {
    // 初始化基础牌组
    this.gameState.deck = [
      { ...this.cards.find((c) => c.id === "strike") },
      { ...this.cards.find((c) => c.id === "strike") },
      { ...this.cards.find((c) => c.id === "strike") },
      { ...this.cards.find((c) => c.id === "strike") },
      { ...this.cards.find((c) => c.id === "strike") },
      { ...this.cards.find((c) => c.id === "defend") },
      { ...this.cards.find((c) => c.id === "defend") },
      { ...this.cards.find((c) => c.id === "defend") },
      { ...this.cards.find((c) => c.id === "defend") },
    ];

    // 用整副牌建立抽牌堆并洗牌（shuffleDeck 本身只打乱现有抽牌堆）
    this.gameState.drawPile = this.shuffleArray([...this.gameState.deck]);
  }

  showTreasure() {
    // 从 cards.json 的稀有牌中抽一张
    const rareCards = this.cards.filter((card) => card.rarity === "rare");
    if (rareCards.length > 0) {
      const randomCard =
        rareCards[Math.floor(Math.random() * rareCards.length)];
      this.gameState.deck.push({ ...randomCard });
      this.addLog(`在宝藏中找到了 ${randomCard.name}！`);
    } else {
      this.addLog("宝藏是空的……");
    }

    this.gameState.currentRoom.completed = true;
    setTimeout(() => {
      this.checkFloorCleared();
      this.switchView("map-view");
      this.updateUI();
    }, 2000);
  }

  showShop() {
    // 简易商店：花费金币买一张随机非基础牌
    const PRICE = 50;
    const affordable = this.gameState.player.gold >= PRICE;

    if (!affordable) {
      this.addLog(`商店：金币不足（需要 ${PRICE}，你有 ${this.gameState.player.gold}）`);
    } else if (confirm(`花 ${PRICE} 金币购买一张随机卡牌？`)) {
      const pool = this.cards.filter((c) => c.rarity !== "basic");
      if (pool.length > 0) {
        const bought = pool[Math.floor(Math.random() * pool.length)];
        this.gameState.deck.push({ ...bought });
        this.gameState.player.gold -= PRICE;
        this.addLog(`购买了 ${bought.name}（-${PRICE} 金币）`);
      } else {
        this.addLog("商店：暂无可购买的卡牌");
      }
    } else {
      this.addLog("商店：你什么也没买");
    }

    this.gameState.currentRoom.completed = true;
    this.checkFloorCleared();
    this.switchView("map-view");
    this.updateUI();
  }

  showRest() {
    const healAmount = Math.floor(this.gameState.player.maxHP * 0.3);
    this.gameState.player.currentHP = Math.min(
      this.gameState.player.maxHP,
      this.gameState.player.currentHP + healAmount,
    );
    this.addLog(`在篝火休息，恢复了 ${healAmount} 点生命值`);

    this.gameState.currentRoom.completed = true;
    setTimeout(() => {
      this.checkFloorCleared();
      this.switchView("map-view");
      this.updateUI();
    }, 2000);
  }
}

// 初始化游戏
let game;
function bootstrapGame() {
  game = new SlayTheSpireGame();
}

// This <script> is a classic script at the end of <body>, so by the time it runs
// `document.readyState` is already "interactive"/"complete" and DOMContentLoaded
// has ALREADY fired. Registering only a DOMContentLoaded listener therefore never
// ran, `game` stayed undefined, and the game never started at all.
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", bootstrapGame);
} else {
  bootstrapGame();
}
