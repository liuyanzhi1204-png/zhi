/* ==========================================================================
 * 青春护航 应急有我 · 星空漫游  ——  main.js
 * --------------------------------------------------------------------------
 * 纯原生 JavaScript，无任何外部库。
 *
 * 模块：
 *   00 CONFIG      全局参数（打字速度 / 漂移幅度等，唯一配置源）
 *   01 SYS         程序级提示文案（错误提示，非叙事文案，故不进 JSON）
 *   02 Utils       工具：clamp / lerp / debounce / 安全写文本 / 模板替换
 *   03 State       运行期状态
 *   04 DOM         元素引用
 *   05 DataService 读取并校验 storyData.json
 *   06 UI          文案注入 / 进度 / 面板 / 大图片卡片 / 遮罩
 *   07 Stars       依坐标生成星点与星轨；星点三态；星点小图
 *   08 Drift       鼠标视差漂移（远层慢、近层快）
 *   09 Typewriter  打字机（40ms/字 + 下划线光标；叙事与结尾共用；严格排队）
 *   10 Loop        渲染循环（漂移缓动 + transform 写入）
 *   11 Flow        流程编排
 *
 * 坐标体系：
 *   storyData.json 里每个点位用 star.x / star.y 描述位置 —— 视口百分比（0-100）。
 *   星点按百分比绝对定位；星轨用 viewBox="0 0 100 100" + preserveAspectRatio="none"
 *   画在同一套百分比上，线宽交给 non-scaling-stroke 保持 1px。
 *   大图片卡片的 transform-origin 由 JS 依星点当时的屏幕坐标算出 ——
 *   卡片看起来就是从被点的那颗星里长出来的。
 *
 * 交互时序（对齐 UI/ui.md）：
 *   点未看的星 → 星转蓝脉冲 → 四页内容就位（标签栏出现）→ 大图卡片从星点位置弹性弹出
 *   （一类叙事同时在底部面板逐字写）→ 叙事播完就停住：不自动换图、不自动收卡片
 *   → 点「科普精讲 / 误区避雷 / 记忆口诀」任一页 = 卡片内淡入第二张照片（二类海报），
 *     场景叙事页同时换成二类叙事 —— 换图只能由这一下点击触发，绝不自动
 *   → 卡片只由鼠标点击（或 ESC）收起；收起时字幕消失、星点位置弹出小图、星转白常亮
 *   点已看的星（回看）→ 只重播大图（四页直接就位、不打字，换图同样靠点那三页）
 *   8 星全看完 → 星轨转金 + 结尾逐字打出（等卡片收起来之后）
 *
 * 底部面板的四个标签页（内容都写在 storyData.json 的点位上）：
 *   场景叙事 = narrative  /  narrative2，跟着两张图走：卡片弹出时逐字写一类，
 *              卡片切到第二张海报时平切换成二类
 *   科普精讲 = aiTip         误区避雷 = myth        记忆口诀 = rhyme
 *   序章没有四类内容，标签栏隐藏，仍走「叙事 → aiTip」的老时序。
 *
 * HUD：左上「返回首页」「重置进度」，右上「已探索 n/总数」+ 胶囊里的可视化进度条。
 *   返回首页保留已探索进度（可再点开始漫游接着走）；重置进度一键清空回到初始状态。
 * ========================================================================== */

(function () {
  'use strict';

  /* ========================================================================
     00 CONFIG
     ======================================================================== */
  var CONFIG = {
    DATA_URL: './storyData.json',

    TYPE_SPEED: 40,          // 叙事打字机 40ms/字（规范 4）
    TITLE_SPEED: 70,         // 结尾标题逐字速度
    END_SPEED: 34,           // 结尾正文逐字速度
    TIP_DELAY: 220,          // 叙事结束 → 科普出现 的间隔
    TIP_HOLD: 520,           // 科普出现后停留多久再播下一条
    OPENING_DELAY: 420,      // 进入漫游 → 开场文本开写
    ENDING_DELAY: 700,       // 全部星点看完 → 弹出结尾
    CARD_OUT_MS: 360,        // 大卡片收起动画时长（与 CSS springOut 对齐）
    GUIDE_DELAY: 1200,       // 进入漫游 → 新手引导浮层出现
    GUIDE_HOLD: 7000,        // 新手引导停留多久后自己退场

    DRIFT_MAX: 16,           // 视差漂移最大位移（px）
    DRIFT_LERP: 0.055        // 视差缓动系数
  };

  /* ========================================================================
     01 SYS：程序级提示
     这几句要在 storyData.json 读取失败时就能显示，所以只能内联在 JS 里。
     除此之外，面向读者的每一个字都来自 storyData.json。
     ======================================================================== */
  var SYS = {
    FATAL_TITLE: 'storyData.json 读取失败',
    FATAL_MSG: '浏览器禁止 file:// 协议下的页面读取本地 JSON（CORS 限制）。请在本项目目录下起一个本地服务器，再用 http:// 地址打开：',
    FATAL_CODE: 'cd "项目目录"\npython3 -m http.server 8000\n\n# 然后浏览器访问：http://localhost:8000'
  };

  /* ========================================================================
     02 Utils
     ======================================================================== */
  var Utils = {
    clamp: function (v, min, max) { return v < min ? min : (v > max ? max : v); },

    lerp: function (a, b, t) { return a + (b - a) * t; },

    /** 尾部防抖：连续调用只在停止 wait 毫秒后真正执行一次 */
    debounce: function (fn, wait) {
      var timer = null;
      return function () {
        var ctx = this, args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = null; fn.apply(ctx, args); }, wait);
      };
    },

    setText: function (el, text) {
      if (el) el.textContent = (text === null || text === undefined) ? '' : String(text);
    },

    /** 文案模板占位符替换（模板本体仍来自 JSON） */
    tpl: function (str, map) {
      return String(str === null || str === undefined ? '' : str)
        .replace(/\{(\w+)\}/g, function (m, key) {
          return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : m;
        });
    },

    round: function (v, n) { var p = Math.pow(10, n); return Math.round(v * p) / p; },

    /** 是否处于移动端布局（与 CSS 断点保持一致） */
    isMobile: function () {
      return window.matchMedia('(max-width: 760px)').matches;
    }
  };

  /* ========================================================================
     03 State
     ======================================================================== */
  var State = {
    data: null,
    spots: [],

    visited: new Set(),            // 已看完点位 id（进度统计 + 结尾判定）

    pending: [],                   // 打字机队列（严格先来先播，等待中的会一直排着）
    typing: false,
    current: null,

    activeSpot: null,              // 大卡片当前展示的点位
    cardOpen: false,
    awaitCardClose: false,         // 叙事已播完但卡片还开着：收尾（星转白 / 小图 / 队列续播）都等它收起来
    photo2Ready: false,            // 一类叙事播完了没：没播完时点标签只翻页，不换海报
    cardTimer: null,

    guideTimer: null,              // 新手引导的出现 / 退场
    coverTimer: null,              // 封面淡出后的收尾
    openingTimer: null,            // 进入漫游 → 开场文本

    endingShown: false,
    endingScheduled: false,
    endingTimer: null,

    running: false,
    rafId: 0,

    drift: { x: 0, y: 0, tx: 0, ty: 0 }
  };

  /* ========================================================================
     04 DOM
     ======================================================================== */
  var DOM = {};

  function cacheDom() {
    [
      'loader', 'cover', 'coverKicker', 'coverTitle', 'coverIntro', 'coverHint', 'startBtn',
      'world', 'worldTitle', 'homeBtn', 'resetBtn', 'progressText', 'hudBarFill', 'guideToast', 'guideText',
      'sky', 'driftFar', 'driftNear', 'trails', 'stars',
      'panel', 'panelHandle', 'panelScene', 'panelName', 'lineNarrative', 'tipBox', 'tipBadge', 'lineTip',
      'tabBtn1', 'tabBtn2', 'tabBtn3', 'tabBtn4', 'pane1', 'pane2', 'pane3', 'pane4', 'lineMyth', 'lineRhyme',
      'bigcard', 'bigcardCard', 'bigcardImg', 'bigcardImg2', 'bigcardPh', 'bigcardPhText',
      'ending', 'endingKicker', 'endingTitle', 'endingBody', 'restartBtn',
      'fatal', 'fatalTitle', 'fatalMsg', 'fatalCode'
    ].forEach(function (id) { DOM[id] = document.getElementById(id); });
  }

  /* ========================================================================
     05 DataService
     ======================================================================== */
  var DataService = {
    load: function (url) {
      // 单文件版：文案数据内联在 <script id="storyData"> 里，直接读，不需要服务器；
      // 开发版没有这个标签，就照常 fetch storyData.json。
      var inline = document.getElementById('storyData');
      if (inline && inline.textContent.trim()) {
        return new Promise(function (resolve) {
          var data = JSON.parse(inline.textContent);
          DataService.validate(data);
          resolve(data);
        });
      }

      return fetch(url, { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
          return res.json();
        })
        .then(function (data) {
          DataService.validate(data);
          return data;
        });
    },

    /** 结构校验 + 容错修正：宁可启动时明确报错，也不要运行时静默失败 */
    validate: function (data) {
      if (!data || typeof data !== 'object') throw new Error('storyData.json 不是合法对象');
      if (!Array.isArray(data.spots) || !data.spots.length) {
        throw new Error('storyData.json 缺少 spots 数组，或数组为空');
      }

      data.spots.forEach(function (spot, i) {
        if (!spot.id) spot.id = 'spot_' + (i + 1);

        if (!spot.star ||
            typeof spot.star.x !== 'number' || isNaN(spot.star.x) ||
            typeof spot.star.y !== 'number' || isNaN(spot.star.y)) {
          throw new Error('点位 ' + spot.id + ' 缺少 star.x / star.y（视口百分比坐标）');
        }

        // 容错：坐标略微超出 0-100 时夹回来，避免星点落到屏幕外
        spot.star.x = Utils.clamp(spot.star.x, 0, 100);
        spot.star.y = Utils.clamp(spot.star.y, 0, 100);

        // 标签 3 / 4 的文案允许暂缺，缺了就是空页，不影响流程
        if (typeof spot.myth !== 'string') spot.myth = '';
        if (typeof spot.rhyme !== 'string') spot.rhyme = '';
        if (typeof spot.narrative2 !== 'string') spot.narrative2 = '';
      });
    }
  };

  /* ========================================================================
     06 UI
     ======================================================================== */
  var UI = {
    /** 把 meta 里的界面文案写进 DOM */
    applyMeta: function (data) {
      var meta = data.meta || {};
      if (meta.siteTitle) document.title = meta.siteTitle;

      Utils.setText(DOM.coverKicker, meta.coverKicker);
      Utils.setText(DOM.coverTitle, meta.coverTitle);
      Utils.setText(DOM.coverIntro, meta.coverIntro);
      Utils.setText(DOM.coverHint, meta.coverHint);
      Utils.setText(DOM.startBtn, meta.startButton);

      Utils.setText(DOM.worldTitle, meta.worldTitle);
      Utils.setText(DOM.homeBtn, meta.homeButton);
      Utils.setText(DOM.resetBtn, meta.resetButton);
      Utils.setText(DOM.guideText, meta.guideHint);

      Utils.setText(DOM.panelScene, meta.panelIdleScene);
      Utils.setText(DOM.panelName, meta.panelIdleName);
      Utils.setText(DOM.tabBtn1, meta.tabNarrative);
      Utils.setText(DOM.tabBtn2, meta.tabTip);
      Utils.setText(DOM.tabBtn3, meta.tabMyth);
      Utils.setText(DOM.tabBtn4, meta.tabRhyme);
      Utils.setText(DOM.tipBadge, meta.tipBadge);
      Utils.setText(DOM.bigcardPhText, meta.imgPlaceholder);

      Utils.setText(DOM.endingKicker, meta.endingKicker);
      Utils.setText(DOM.restartBtn, meta.endingButton);
    },

    /** 右上角「已探索 n/总数」+ 胶囊里的细进度条（总数取自 spots 长度） */
    updateProgress: function (n, total) {
      var meta = (State.data && State.data.meta) || {};
      Utils.setText(DOM.progressText, Utils.tpl(meta.progressTpl, { n: n, total: total }));
      if (DOM.hudBarFill) {
        DOM.hudBarFill.style.width = (total > 0 ? (n / total) * 100 : 0) + '%';
      }
    },

    setHead: function (scene, name) {
      Utils.setText(DOM.panelScene, scene);
      Utils.setText(DOM.panelName, name);
    },

    /** 切到第 n 个标签页（1-4）：标签高亮与内容页同进同出 */
    selectTab: function (n) {
      var idx = Utils.clamp(n | 0, 1, 4);
      [DOM.tabBtn1, DOM.tabBtn2, DOM.tabBtn3, DOM.tabBtn4].forEach(function (btn, i) {
        if (btn) btn.classList.toggle('is-active', i + 1 === idx);
      });
      [DOM.pane1, DOM.pane2, DOM.pane3, DOM.pane4].forEach(function (pane, i) {
        if (pane) pane.classList.toggle('is-active', i + 1 === idx);
      });
    },

    /** 点位内容就位：标签栏出现，四页一次填好，视线回到第 1 页（场景叙事） */
    loadSpotTabs: function (spot) {
      DOM.panel.classList.add('panel--spot');
      UI.setTip(spot.aiTip);
      DOM.tipBox.classList.add('is-in');        // 点位的科普不必再演一次「揭示」，切过去就能读
      Utils.setText(DOM.lineMyth, spot.myth);
      Utils.setText(DOM.lineRhyme, spot.rhyme);
      UI.selectTab(1);
    },

    /** 面板回到初始态：闲置标题 + 四页清空 + 标签栏收起（回看关卡片、重置进度都走这里） */
    resetPanel: function () {
      var meta = (State.data && State.data.meta) || {};
      UI.setHead(meta.panelIdleScene, meta.panelIdleName);
      UI.clearLines();
      Utils.setText(DOM.lineMyth, '');
      Utils.setText(DOM.lineRhyme, '');
      DOM.panel.classList.remove('panel--spot');
      UI.selectTab(1);
    },

    /** 清空叙事与科普，准备播下一条 */
    clearLines: function () {
      Utils.setText(DOM.lineNarrative, '');
      Utils.setText(DOM.lineTip, '');
      DOM.tipBox.classList.remove('is-in');
    },

    setTip: function (text) { Utils.setText(DOM.lineTip, text); },

    /** 只换叙事那一行（不动科普区）—— 卡片切到第二张图时用 */
    setNarrative: function (text) { Utils.setText(DOM.lineNarrative, text); },

    openDrawer: function () {
      if (Utils.isMobile()) DOM.panel.classList.add('is-open');
    },

    hideLoader: function () {
      DOM.loader.classList.add('is-leaving');
      setTimeout(function () { DOM.loader.classList.add('is-hidden'); }, 520);
    },

    showCover: function () {
      clearTimeout(State.coverTimer);           // 防上一次淡出的收尾定时器把刚回来的封面又藏了
      State.coverTimer = null;
      DOM.cover.classList.remove('is-leaving', 'is-hidden');
    },

    hideCover: function () {
      DOM.cover.classList.add('is-leaving');
      clearTimeout(State.coverTimer);
      State.coverTimer = setTimeout(function () {
        State.coverTimer = null;
        DOM.cover.classList.add('is-hidden');
        DOM.cover.classList.remove('is-leaving');
      }, 900);
    },

    showWorld: function () { DOM.world.classList.remove('is-hidden'); },

    hideWorld: function () { DOM.world.classList.add('is-hidden'); },

    /** 新手引导：进入漫游后出现，停留 GUIDE_HOLD 后自己退场（点星会立刻收掉） */
    showGuide: function () {
      clearTimeout(State.guideTimer);
      State.guideTimer = setTimeout(function () {
        DOM.guideToast.classList.add('is-in');
        State.guideTimer = setTimeout(UI.hideGuide, CONFIG.GUIDE_HOLD);
      }, CONFIG.GUIDE_DELAY);
    },

    hideGuide: function () {
      clearTimeout(State.guideTimer);
      State.guideTimer = null;
      DOM.guideToast.classList.remove('is-in');
    },

    /**
     * 大图片卡片：以被点星点的屏幕位置为缩放原点弹出来。
     * 图片加载失败（或没有 image 字段）→ 换成「应急场景示意图」占位图，
     * 文字功能不受影响、流程不中断。
     */
    openBigCard: function (spot) {
      var img = DOM.bigcardImg;
      var img2 = DOM.bigcardImg2;
      var ph = DOM.bigcardPh;
      var meta = (State.data && State.data.meta) || {};

      State.cardOpen = true;
      State.activeSpot = spot;
      State.photo2Ready = false;
      clearTimeout(State.cardTimer);

      // 第二张照片：每次开卡片都先退回透明，等叙事播完再交叉淡入。
      // 缺图 / 加载失败 → 标记在点位上，之后只播第一张，流程照常
      img2.classList.remove('is-in');
      img2.removeAttribute('src');
      if (spot.image2 && !spot.img2Broken) {
        img2.onerror = function () {
          spot.img2Broken = true;
          img2.removeAttribute('src');
          img2.classList.remove('is-in');
        };
        img2.src = spot.image2;
      }

      img.classList.remove('is-hidden');
      ph.classList.add('is-hidden');
      ph.classList.remove('is-in');
      Utils.setText(DOM.bigcardPhText, meta.imgPlaceholder);

      // 占位图：记在 spot 上，下次再点直接走兜底，不再尝试加载
      function fallback() {
        spot.imgBroken = true;
        img.classList.add('is-hidden');
        ph.classList.remove('is-hidden');
        requestAnimationFrame(function () { ph.classList.add('is-in'); });
      }

      if (spot.image && !spot.imgBroken) {
        img.alt = spot.name || '';
        img.onerror = fallback;
        img.src = spot.image;
      } else {
        fallback();
      }

      DOM.bigcard.classList.remove('is-in', 'is-closing', 'is-hidden');

      // 等一帧：卡片先完成布局，才能量出星点相对卡片的原点
      requestAnimationFrame(function () {
        var star = Stars.el(spot.id);
        var cr = DOM.bigcardCard.getBoundingClientRect();
        var sr = star ? star.getBoundingClientRect() : null;
        var ox = sr ? (sr.left + sr.width / 2 - cr.left) : cr.width / 2;
        var oy = sr ? (sr.top + sr.height / 2 - cr.top) : cr.height / 2;
        DOM.bigcardCard.style.transformOrigin =
          Utils.round(ox, 1) + 'px ' + Utils.round(oy, 1) + 'px';
        DOM.bigcard.classList.add('is-in');
      });
    },

    /** 第一张照片停留结束：卡片过渡到第二张的比例，同时把第二张交叉淡入。
        没配图 / 加载失败 / 卡片已被点掉 → 返回 false，静默跳过（时序不受影响） */
    showSecondPhoto: function (spot) {
      var card = DOM.bigcardCard;
      var img2 = DOM.bigcardImg2;

      if (!State.cardOpen || !spot || !spot.image2 || spot.img2Broken) return false;
      if (!img2.naturalWidth) return false;              // 图还没解码完，这一轮先不换

      // 先把卡片现在的尺寸定格成像素值（当帧无变化），
      // 再改成第二张的比例 —— 两端都是明确像素，width/height 才过渡得起来
      card.style.width = card.offsetWidth + 'px';
      card.style.height = card.offsetHeight + 'px';
      void card.offsetWidth;

      // 目标尺寸：约束（max-width / max-height）直接从 CSS 读，不在 JS 里抄一遍
      var cs = window.getComputedStyle(DOM.bigcardImg);
      var maxW = parseFloat(cs.maxWidth) || window.innerWidth * 0.92;
      var maxH = parseFloat(cs.maxHeight) || window.innerHeight * 0.64;
      var ar = img2.naturalWidth / img2.naturalHeight;
      var w = Math.min(maxW, maxH * ar);

      card.classList.add('is-photo2');
      card.style.width = Utils.round(w, 1) + 'px';
      card.style.height = Utils.round(w / ar, 1) + 'px';
      img2.classList.add('is-in');
      return true;
    },

    /** 换图状态还原：清掉像素尺寸，下次开卡片照旧从第一张的比例长出来 */
    resetSecondPhoto: function () {
      DOM.bigcardCard.classList.remove('is-photo2');
      DOM.bigcardCard.style.width = '';
      DOM.bigcardCard.style.height = '';
      DOM.bigcardImg2.classList.remove('is-in');
    },

    /** 收起大卡片；已经收起时直接回调 */
    closeBigCard: function (done) {
      if (!State.cardOpen) { if (done) done(); return; }

      State.cardOpen = false;
      State.activeSpot = null;
      clearTimeout(State.cardTimer);

      DOM.bigcard.classList.add('is-closing');
      State.cardTimer = setTimeout(function () {
        DOM.bigcard.classList.remove('is-in', 'is-closing');
        DOM.bigcard.classList.add('is-hidden');
        UI.resetSecondPhoto();
        if (done) done();
      }, CONFIG.CARD_OUT_MS);
    },

    /** 结尾弹层：标题与正文逐字打出，打完按钮才浮现 */
    showEnding: function (data) {
      var ending = data.ending || {};
      var paras = ending.paragraphs || [];
      var i = 0;

      Utils.setText(DOM.endingTitle, '');
      DOM.endingBody.textContent = '';
      DOM.restartBtn.classList.remove('is-in');
      DOM.ending.classList.remove('is-hidden');

      function nextPara() {
        if (i >= paras.length) {
          DOM.restartBtn.classList.add('is-in');
          return;
        }
        var p = document.createElement('p');
        p.className = 'ending__p';
        DOM.endingBody.appendChild(p);
        Typewriter.typeInto(p, paras[i], CONFIG.END_SPEED, null, function () {
          i += 1;
          nextPara();
        });
      }

      Typewriter.typeInto(DOM.endingTitle, ending.title, CONFIG.TITLE_SPEED, 'ending__caret', nextPara);
    },

    showFatal: function (err) {
      DOM.loader.classList.add('is-hidden');
      Utils.setText(DOM.fatalTitle, SYS.FATAL_TITLE);
      Utils.setText(DOM.fatalMsg, SYS.FATAL_MSG);
      Utils.setText(DOM.fatalCode, SYS.FATAL_CODE + '\n\n错误详情：' + (err && err.message ? err.message : err));
      DOM.fatal.classList.remove('is-hidden');
    }
  };

  /* ========================================================================
     07 Stars：依 spots 生成 8 颗星点 + 依序相连的星轨
     星点三态由 class 控制（样式在 style.css 第 08 节）：
       默认橙色呼吸 · .is-active 蓝色脉冲 · .is-visited 白色常亮
     ======================================================================== */
  var Stars = (function () {
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var els = {};                       // spotId → 星点按钮

    function line(a, b) {
      var l = document.createElementNS(SVG_NS, 'line');
      l.setAttribute('x1', a.x); l.setAttribute('y1', a.y);
      l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
      return l;
    }

    /** 图片缺失 / 加载失败时的占位小图 */
    function renderThumbPh(box) {
      box.textContent = '';
      var ph = document.createElement('span');
      ph.className = 'thumb__ph';
      Utils.setText(ph, (State.data && State.data.meta || {}).imgPlaceholder);
      box.appendChild(ph);
    }

    return {
      build: function (spots) {
        els = {};
        DOM.stars.textContent = '';
        DOM.trails.textContent = '';

        var frag = document.createDocumentFragment();
        var trail = document.createDocumentFragment();

        spots.forEach(function (spot, i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'star';
          b.setAttribute('data-spot-id', spot.id);
          b.setAttribute('aria-label', [spot.scene, spot.name].filter(Boolean).join(' '));
          b.style.left = spot.star.x + '%';
          b.style.top = spot.star.y + '%';

          var halo = document.createElement('span');
          halo.className = 'star__halo';
          var core = document.createElement('span');
          core.className = 'star__core';
          b.appendChild(halo);
          b.appendChild(core);

          b.addEventListener('click', function () { Flow.onStarClick(spot); });

          els[spot.id] = b;
          frag.appendChild(b);

          if (i > 0) trail.appendChild(line(spots[i - 1].star, spot.star));
        });

        DOM.stars.appendChild(frag);
        DOM.trails.appendChild(trail);
      },

      el: function (id) { return els[id] || null; },

      /** 按 data 顺序返回星点按钮（键盘 ← → 用） */
      list: function () {
        return State.spots.map(function (s) { return els[s.id]; }).filter(Boolean);
      },

      setState: function (spot, state) {
        var b = els[spot.id];
        if (!b) return;
        b.classList.toggle('is-active', state === 'active');
        b.classList.toggle('is-visited', state === 'visited');
      },

      /** 全部看完：星轨整体转金色发光 */
      gold: function () { DOM.trails.classList.add('is-gold'); },

      /** 叙事播完：在星点位置挂一张小图（已挂过则不动） */
      showThumb: function (spot) {
        var b = els[spot.id];
        if (!b || b.querySelector('.star__thumb')) return;

        var box = document.createElement('span');
        box.className = 'star__thumb';

        if (spot.image && !spot.imgBroken) {
          var img = document.createElement('img');
          img.alt = '';
          img.addEventListener('error', function () {
            spot.imgBroken = true;
            renderThumbPh(box);
          });
          img.src = spot.image;
          box.appendChild(img);
        } else {
          renderThumbPh(box);
        }

        b.appendChild(box);
        requestAnimationFrame(function () { box.classList.add('is-in'); });
      }
    };
  })();

  /* ========================================================================
     08 Drift：鼠标视差漂移
     指针位置映射为反向小位移（鼠标向右，星空向左让开），
     原地点在 Loop 里缓动写入 —— 远层只走 45%，近层走满，形成纵深。
     ======================================================================== */
  var Drift = {
    bind: function () {
      window.addEventListener('pointermove', Drift.onMove, { passive: true });
    },

    onMove: function (e) {
      var w = window.innerWidth || 1;
      var h = window.innerHeight || 1;
      var dx = (e.clientX / w - 0.5) * 2;          // -1 .. 1
      var dy = (e.clientY / h - 0.5) * 2;
      State.drift.tx = -dx * CONFIG.DRIFT_MAX;
      State.drift.ty = -dy * CONFIG.DRIFT_MAX * 0.62;
    },

    step: function () {
      var d = State.drift;
      d.x = Utils.lerp(d.x, d.tx, CONFIG.DRIFT_LERP);
      d.y = Utils.lerp(d.y, d.ty, CONFIG.DRIFT_LERP);
      if (Math.abs(d.x - d.tx) < 0.03 && Math.abs(d.y - d.ty) < 0.03) {
        d.x = d.tx;
        d.y = d.ty;
      }
    }
  };

  /* ========================================================================
     09 Typewriter：先逐字写叙事；点位写完就停住等鼠标
     严格排队：一条没播完之前，后面进来的都只入队等待，不打断、不丢弃。
     序章没有卡片，写完直接接科普；点位则把收尾交给「点掉大卡片」那一下。
     ======================================================================== */
  var Typewriter = (function () {
    var timer = null;

    function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

    /** 叙事完整播完 = 这一点位才算「已探索」（只影响进度计数与结尾判定） */
    function markRead(item) {
      if (!item || !item.spot) return;                // 开场文本不是点位
      if (State.visited.has(item.spot.id)) return;

      State.visited.add(item.spot.id);
      UI.updateProgress(State.visited.size, State.spots.length);
    }

    /** 点位收尾：清掉叙事行（保留科普页）、翻到科普精讲、星点转白并弹出小图 */
    function settleSpot(spot) {
      UI.setNarrative('');
      UI.selectTab(2);
      Stars.setState(spot, 'visited');
      Stars.showThumb(spot);
    }

    /** 首看的卡片被点掉之后：收尾 + 队列接着走（空了就由 next 去问该不该弹结尾） */
    function afterCardClosed(spot) {
      if (!State.awaitCardClose) return false;        // 回看、或卡片是提前点掉的
      State.awaitCardClose = false;
      if (spot) settleSpot(spot);
      next();
      return true;
    }

    function wait(ms, done) {
      clearTimer();
      timer = setTimeout(function () { timer = null; done(); }, ms);
    }

    /** 逐字写入任意元素；caretClass 非空时末尾挂一个闪烁光标 */
    function typeInto(el, text, speed, caretClass, done) {
      var full = (text === null || text === undefined) ? '' : String(text);
      var node = document.createTextNode('');
      var caret = null;

      el.appendChild(node);
      if (caretClass) {
        caret = document.createElement('span');
        caret.className = caretClass;
        el.appendChild(caret);
      }

      function finish() {
        if (caret && caret.parentNode) caret.parentNode.removeChild(caret);
        el.normalize();                               // 合并逐字产生的文本节点
        done();
      }

      if (!full.length) { finish(); return; }

      var i = 0;
      (function step() {
        i += 1;
        node.nodeValue = full.slice(0, i);

        if (i >= full.length) { finish(); return; }
        clearTimer();
        timer = setTimeout(step, speed);
      })();
    }

    /** 科普整体出现（平切，不加过渡） */
    function revealTip(text, done) {
      UI.setTip(text);
      DOM.tipBox.classList.add('is-in');
      wait(CONFIG.TIP_HOLD, done);
    }

    function next() {
      clearTimer();

      if (!State.pending.length) {
        State.typing = false;
        State.current = null;
        Flow.onIdle();
        return;
      }

      State.typing = true;
      State.current = State.pending.shift();
      var item = State.current;

      UI.setHead(item.scene, item.name);
      UI.clearLines();

      // 点位：四页内容先就位（标签栏出现），大图卡片再从星点位置弹出来
      // 顺序要紧 —— loadSpotTabs 必须在 clearLines 之后，否则刚填好的科普页会被清掉
      if (item.spot) {
        UI.loadSpotTabs(item.spot);
        Stars.setState(item.spot, 'active');
        UI.openBigCard(item.spot);
      }

      typeInto(DOM.lineNarrative, item.narrative, CONFIG.TYPE_SPEED, 'panel__caret', function () {
        markRead(item);

        // 开场文本：没有卡片与星点，写完翻到科普那一页
        if (!item.spot) {
          UI.selectTab(2);
          wait(CONFIG.TIP_DELAY, function () { revealTip(item.aiTip, next); });
          return;
        }

        // 点位叙事播完就停住 —— 不自动换图、不自动收卡片：
        // 换海报要点那三个标签，收卡片要再点一下，收尾留到卡片收起来时做
        State.photo2Ready = true;
        if (State.cardOpen) { State.awaitCardClose = true; return; }

        settleSpot(item.spot);          // 观众提前点掉了卡片，当场收尾
        next();
      });
    }

    return {
      enqueue: function (item) {
        if (!item) return;
        State.pending.push(item);
        if (!State.typing) next();                    // 只有空闲时才立刻开播
      },

      /** 当前是否还在播（含正在打字与已入队等待的），Flow 用它决定收不收新的点星 */
      isBusy: function () {
        return State.typing || State.pending.length > 0;
      },

      /** 停机：正在打的字与排队等着的都作废，等卡片收起来的那份约定也一并取消 */
      reset: function () {
        clearTimer();
        State.pending.length = 0;
        State.typing = false;
        State.current = null;
        State.awaitCardClose = false;
      },

      afterCardClosed: afterCardClosed,

      typeInto: typeInto
    };
  })();

  /* ========================================================================
     10 Loop：漂移缓动 + transform 写入
     ======================================================================== */
  var Loop = {
    last: { x: null, y: null },

    start: function () {
      if (State.running) return;
      State.running = true;
      Loop.rafId = requestAnimationFrame(Loop.tick);
    },

    stop: function () {
      State.running = false;
      cancelAnimationFrame(Loop.rafId);
    },

    tick: function () {
      Loop.rafId = requestAnimationFrame(Loop.tick);
      Drift.step();
      Loop.apply();
    },

    /** 数值无变化时跳过 DOM 写入 */
    apply: function () {
      var d = State.drift;
      var x = Utils.round(d.x, 2);
      var y = Utils.round(d.y, 2);
      if (Loop.last.x === x && Loop.last.y === y) return;

      Loop.last.x = x;
      Loop.last.y = y;
      DOM.driftFar.style.transform = 'translate3d(' + Utils.round(x * 0.45, 2) + 'px,' + Utils.round(y * 0.45, 2) + 'px,0)';
      DOM.driftNear.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    }
  };

  /* ========================================================================
     11 Flow
     ======================================================================== */
  var Flow = {
    boot: function () {
      cacheDom();
      Drift.bind();
      Flow.bindEvents();

      DataService.load(CONFIG.DATA_URL)
        .then(function (data) {
          State.data = data;
          State.spots = data.spots;

          UI.applyMeta(data);
          Stars.build(State.spots);
          UI.updateProgress(0, State.spots.length);
          Flow.preload();

          UI.hideLoader();
          UI.showCover();
        })
        .catch(function (err) {
          console.error('[应急星图] storyData.json 读取失败：', err);
          UI.showFatal(err);
        });
    },

    /** 封面展示期间后台预热 8 张图：点星时大卡能立即成形；
        加载失败的记在点位上，之后直接走占位图 */
    preload: function () {
      function warm(spot, field, flag) {
        if (!spot[field] || spot[flag]) return;
        var im = new Image();
        im.onerror = function () { spot[flag] = true; };
        im.src = spot[field];
      }

      State.spots.forEach(function (spot) {
        warm(spot, 'image', 'imgBroken');
        warm(spot, 'image2', 'img2Broken');
      });
    },

    bindEvents: function () {
      DOM.startBtn.addEventListener('click', Flow.enterWorld);
      DOM.restartBtn.addEventListener('click', function () { window.location.reload(); });
      DOM.homeBtn.addEventListener('click', Flow.goHome);
      DOM.resetBtn.addEventListener('click', Flow.resetProgress);

      // 面板标签页：四个按钮各自切自己那一页；点 2/3/4 这三页 = 请求换二类海报
      [DOM.tabBtn1, DOM.tabBtn2, DOM.tabBtn3, DOM.tabBtn4].forEach(function (btn, i) {
        if (btn) btn.addEventListener('click', function () { Flow.onTabClick(i + 1); });
      });

      // 大卡片：点任意处（含遮罩）关闭
      DOM.bigcard.addEventListener('click', Flow.onCardDismiss);

      window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') Flow.onCardDismiss();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          Flow.moveFocus(e.key === 'ArrowRight' ? 1 : -1);
        }
      });

      // 移动端抽屉把手
      DOM.panelHandle.addEventListener('click', function () {
        DOM.panel.classList.toggle('is-open');
      });
      DOM.panelHandle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          DOM.panel.classList.toggle('is-open');
        }
      });

      // 从移动端切回桌面端时，收掉抽屉状态，避免残留
      window.addEventListener('resize', Utils.debounce(function () {
        if (!Utils.isMobile()) DOM.panel.classList.remove('is-open');
      }, 140));
    },

    /** 键盘兜底：← → 在 8 颗星之间移动焦点，Enter / Space 点亮 */
    moveFocus: function (dir) {
      var nodes = Stars.list();
      if (!nodes.length) return;
      var i = nodes.indexOf(document.activeElement);
      var next = i < 0
        ? (dir > 0 ? 0 : nodes.length - 1)
        : (i + dir + nodes.length) % nodes.length;
      nodes[next].focus();
    },

    /** 点星：未看的走完整流程；已看的只重播大图，不再打字 */
    onStarClick: function (spot) {
      if (!State.running || State.endingShown) return;

      UI.openDrawer();
      UI.hideGuide();

      if (State.visited.has(spot.id)) {
        // 重播不排队：上一条还在播时先安静等着，避免两张卡片打架
        if (Typewriter.isBusy() || State.cardOpen) return;

        State.reviewMode = true;                 // 关卡片时要把面板还原，不留上一个点位的字
        Stars.setState(spot, 'active');
        UI.openBigCard(spot);

        // 回看不打字：四页内容直接就位，两类叙事跟图片平切
        UI.setHead(spot.scene, spot.name);
        UI.clearLines();
        UI.loadSpotTabs(spot);
        UI.setNarrative(spot.narrative);

        State.photo2Ready = true;         // 回看不打字：换海报那一下点击立刻可用
        return;
      }

      // 未看的点星一律收下：忙时进队列，严格先来先播，不丢点击
      if (State.cardOpen || spot.enqueued) return;
      spot.enqueued = true;
      Typewriter.enqueue({
        spot: spot, scene: spot.scene, name: spot.name,
        narrative: spot.narrative, narrative2: spot.narrative2, aiTip: spot.aiTip
      });
    },

    /** 标签页点击：先翻页；点科普精讲 / 误区避雷 / 记忆口诀 时把卡片里的图换成二类海报。
        换图只由这一下点击触发 —— 一类叙事还没打完就先只翻页，等打完再点才换 */
    onTabClick: function (n) {
      UI.selectTab(n);

      if (n < 2) return;                         // 第 1 页只看一类叙事
      var spot = State.activeSpot;
      if (!State.cardOpen || !spot || !State.photo2Ready) return;
      if (UI.showSecondPhoto(spot)) UI.setNarrative(spot.narrative2);
    },

    /** 大卡片点任意处 / ESC 收起 */
    onCardDismiss: function () {
      var s = State.activeSpot;
      var wasReview = State.reviewMode;
      State.reviewMode = false;

      UI.closeBigCard(function () {
        // 首看：清字幕、星点转白 + 小图、面板翻回科普精讲，队列接着走
        if (Typewriter.afterCardClosed(s)) return;

        if (s && State.visited.has(s.id)) Stars.setState(s, 'visited');
        // 回看只是「再看一眼图片」，关掉面板就该干净 —— 不留上一条的叙事与标题
        if (wasReview) UI.resetPanel();
      });
    },

    enterWorld: function () {
      DOM.startBtn.disabled = true;

      UI.hideCover();
      UI.showWorld();
      Loop.start();
      UI.showGuide();

      // 开场文本走与点位相同的打字机管道
      var op = State.data.opening || {};
      clearTimeout(State.openingTimer);
      State.openingTimer = setTimeout(function () {
        UI.openDrawer();
        Typewriter.enqueue({
          scene: op.scene, name: op.name,
          narrative: op.narrative, aiTip: op.aiTip
        });
      }, CONFIG.OPENING_DELAY);
    },

    /** 停机：中止打字机与所有排期、收起卡片、清掉点位的排队标记 */
    shutdown: function () {
      State.reviewMode = false;
      clearTimeout(State.openingTimer);
      clearTimeout(State.endingTimer);
      State.endingScheduled = false;
      Typewriter.reset();
      UI.hideGuide();
      UI.closeBigCard();
      State.spots.forEach(function (s) { s.enqueued = false; });
    },

    /** 返回首页：世界停摆、封面回来。已探索进度保留，再点「开始漫游」接着走 */
    goHome: function () {
      if (!State.data) return;
      Flow.shutdown();
      Loop.stop();
      UI.resetPanel();
      UI.hideWorld();
      UI.showCover();
      DOM.startBtn.disabled = false;
    },

    /** 一键回到初始状态：进度、星点、面板、结尾全部归零，人留在漫游页接着看 */
    resetProgress: function () {
      if (!State.data) return;
      Flow.shutdown();
      State.endingShown = false;
      State.visited.clear();

      DOM.ending.classList.add('is-hidden');
      Stars.build(State.spots);                  // 重建星点：状态类与小图一起清掉
      DOM.trails.classList.remove('is-gold');
      UI.updateProgress(0, State.spots.length);
      UI.resetPanel();

      Loop.start();
    },

    /** 打字机空闲时检查：8 颗星全部看完 → 排期弹出结尾 */
    onIdle: function () {
      if (State.endingShown || State.endingScheduled) return;
      if (!State.spots.length) return;
      if (State.visited.size < State.spots.length) return;

      State.endingScheduled = true;
      clearTimeout(State.endingTimer);
      State.endingTimer = setTimeout(function () {
        State.endingScheduled = false;
        if (!State.endingShown && State.visited.size >= State.spots.length) {
          Flow.showEnding();
        }
      }, CONFIG.ENDING_DELAY);
    },

    showEnding: function () {
      State.endingShown = true;
      Stars.gold();                      // 星轨全部点亮成金色
      UI.showEnding(State.data);         // 标题与正文逐字打出
      Loop.stop();                       // 结尾出现后暂停渲染循环
    }
  };

  /* ========================================================================
     启动
     ======================================================================== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Flow.boot);
  } else {
    Flow.boot();
  }
})();
