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
    // 这里应该是从服务器加载数据，暂时用本地数据
    this.cards = [
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
      {
        id: "bash",
        name: "重击",
        type: "attack",
        cost: 2,
        damage: 8,
        description: "造成8点伤害",
        rarity: "common",
      },
      {
        id: "iron_wave",
        name: "铁斩波",
        type: "attack",
        cost: 1,
        damage: 5,
        block: 5,
        description: "造成5点伤害，获得5点格挡",
        rarity: "common",
      },
    ];

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
      },
      {
        id: "snake_ring",
        name: "蛇之戒指",
        description: "每回合额外抽1张牌",
        effect: "extra_card_draw",
      },
    ];
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

    document.getElementById("draw-cards-btn").addEventListener("click", () => {
      this.drawCards(1);
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
    };

    this.shuffleDeck();
    this.drawInitialHand();
    this.updateBattleUI();
    this.addLog("战斗开始！");
  }

  shuffleDeck() {
    this.gameState.drawPile = [...this.gameState.deck];
    for (let i = this.gameState.drawPile.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.gameState.drawPile[i], this.gameState.drawPile[j]] = [
        this.gameState.drawPile[j],
        this.gameState.drawPile[i],
      ];
    }
  }

  drawInitialHand() {
    this.gameState.hand = [];
    for (let i = 0; i < 5; i++) {
      this.drawCard();
    }
    this.updateHandUI();
  }

  drawCard() {
    if (this.gameState.drawPile.length === 0) {
      // 洗入弃牌堆
      this.gameState.drawPile = [...this.gameState.discard];
      this.gameState.discard = [];
      this.shuffleDeck();
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

    // 消耗能量
    this.gameState.player.energy -= card.cost;

    // 应用卡牌效果
    this.applyCardEffect(card);

    // 移除手牌
    this.gameState.hand.splice(cardIndex, 1);
    this.gameState.discard.push(card);

    this.updateUI();
    this.addLog(`使用了 ${card.name}`);
  }

  applyCardEffect(card) {
    const enemy = this.gameState.battle.enemies[0];

    if (card.damage) {
      const damage = card.damage;
      enemy.currentHP -= damage;
      this.addLog(`对 ${enemy.name} 造成 ${damage} 点伤害`);

      if (enemy.currentHP <= 0) {
        this.victory();
      }
    }

    if (card.block) {
      this.gameState.player.block += card.block;
      this.addLog(`获得了 ${card.block} 点格挡`);
    }
  }

  endTurn() {
    this.addLog("--- 回合结束 ---");

    // 敌人行动
    this.enemyTurn();

    // 清理状态
    this.gameState.player.block = 0;
    this.gameState.player.energy = this.gameState.player.maxEnergy;

    // 弃掉手牌
    this.gameState.discard.push(...this.gameState.hand);
    this.gameState.hand = [];

    // 抽新牌
    for (let i = 0; i < 5; i++) {
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
      case "attack":
        const damage = Math.max(0, action.damage - this.gameState.player.block);
        this.gameState.player.currentHP -= damage;
        this.gameState.player.block = Math.max(
          0,
          this.gameState.player.block - action.damage,
        );
        this.addLog(`${enemy.name} 攻击，造成 ${action.damage} 点伤害`);
        break;

      case "block":
        // 敌人获得格挡
        this.addLog(`${enemy.name} 进行了防御`);
        break;

      case "buff":
        // 敌人强化
        this.addLog(`${enemy.name} 强化了自己`);
        break;
    }

    // 检查玩家死亡
    if (this.gameState.player.currentHP <= 0) {
      this.gameOver();
    }
  }

  victory() {
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

    // 回到地图
    setTimeout(() => {
      this.switchView("map-view");
      this.updateUI();
    }, 2000);
  }

  gameOver() {
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

    this.shuffleDeck();
  }

  showTreasure() {
    // 模拟宝藏房间
    const rareCards = this.cards.filter((card) => card.rarity === "rare");
    if (rareCards.length > 0) {
      const randomCard =
        rareCards[Math.floor(Math.random() * rareCards.length)];
      this.gameState.deck.push({ ...randomCard });
      this.addLog(`在宝藏中找到了 ${randomCard.name}！`);
    }

    this.gameState.currentRoom.completed = true;
    setTimeout(() => this.switchView("map-view"), 2000);
  }

  showShop() {
    alert("商店（功能开发中）");
    this.gameState.currentRoom.completed = true;
    this.switchView("map-view");
  }

  showRest() {
    const healAmount = Math.floor(this.gameState.player.maxHP * 0.3);
    this.gameState.player.currentHP = Math.min(
      this.gameState.player.maxHP,
      this.gameState.player.currentHP + healAmount,
    );
    this.addLog(`在篝火休息，恢复了 ${healAmount} 点生命值`);

    this.gameState.currentRoom.completed = true;
    setTimeout(() => this.switchView("map-view"), 2000);
  }
}

// 初始化游戏
let game;
window.addEventListener("DOMContentLoaded", () => {
  game = new SlayTheSpireGame();
});
