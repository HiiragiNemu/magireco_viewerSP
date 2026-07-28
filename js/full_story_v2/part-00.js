(function () {
  'use strict';

  const CONFIG = Object.freeze({
    storyRevision: 'c68110c495a895be77e349ae85fe36939974d7bc',
    storyRepo: 'HiiragiNemu/magi-reader',
    storyIndex: 'website/public/story_index.json',
    assetBase: 'https://pub-70a248f1a6fe4ca597e7a10f8b95dfd8.r2.dev',
    pageSize: 60,
    maxIndexBytes: 32 * 1024 * 1024,
    maxStoryBytes: 16 * 1024 * 1024,
    textSpeedMs: 24,
    autoExtraMs: 650,
    modelRetryMs: 15000,
  });

  const RAW = `https://raw.githubusercontent.com/${CONFIG.storyRepo}/${CONFIG.storyRevision}/`;
  const POSITION_X = Object.freeze([120, 850, 1580]);
  const POSITION_PERCENT = Object.freeze([25, 50, 75]);
  const DIALOGUE_FIELDS = Object.freeze([
    ['textLeft', 0, 'standard'],
    ['textCenter', 1, 'standard'],
    ['textRight', 2, 'standard'],
    ['textAvLeft', 0, 'av'],
    ['textAvCenter', 1, 'av'],
    ['textAvRight', 2, 'av'],
  ]);
  const CLICK_FIELDS = Object.freeze([
    'textLeft', 'textCenter', 'textRight',
    'textAvLeft', 'textAvCenter', 'textAvRight',
    'narration', 'progressNarration', 'progressFnarration',
    'voice', 'voiceFull', 'voiceFullAuto',
  ]);
  const JP_PARENT_ALIASES = new Map([
    [
      'event_story/5101 - 常夜之国的叛乱者～魔法少女贞德～',
      'event_story/5101 - 常夜之国的叛乱者 ~魔法少女贞德~',
    ],
    [
      'event_story/5175 - Dream Halloween Festa～阿莉娜前辈！做个好孩子！～',
      'event_story/5175 - Dream Halloween Festa～阿莉娜前辈！做要好孩子的说！～',
    ],
    [
      'event_story/5216 - 海岸边的缎带',
      'event_story/5216 - 海边的缎带',
    ],
  ]);

  const collator = new Intl.Collator(['zh-CN', 'ja-JP'], {
    numeric: true,
    sensitivity: 'base',
  });

  const catalog = {
    all: [],
    filtered: [],
    page: 0,
    selected: null,
    loaded: false,
    loading: null,
    oldQuestPage: null,
    oldMainPage: null,
    player: null,
  };

  const byId = (value) => document.getElementById(value);

  function encodePath(value) {
    return String(value)
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
  }

  function normalizedText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase('zh-CN')
      .replace(/\s+/g, '');
  }

  function storyTitle(entry) {
    const value = String(entry.title || entry.folder || '').trim();
    return `${entry.id} · ${value || entry.source_identity}`;
  }

  function status(message, bad = false) {
    const node = byId('full-story-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('bad', Boolean(bad));
  }

  async function fetchJson(url, maxBytes) {
    const response = await fetch(url, {
      cache: 'force-cache',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      throw new Error(`JSON 超过限制：${bytes.byteLength.toLocaleString()} bytes`);
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : error}`);
    }
  }

  function sourcePath(entry, section, language) {
    let sourceIdentity = String(entry.source_identity || '').replace(/\\/g, '/');
    let parent = sourceIdentity.split('/').slice(0, -1).join('/');
    if (language === 'jp') parent = JP_PARENT_ALIASES.get(parent) || parent;
    const marker = section.search(/\s+Section(?:\s|$)/i);
    const stem = (marker >= 0 ? section.slice(0, marker) : section)
      .trim()
      .replace(/\.json$/i, '');
    const tree = language === 'cn'
      ? 'magireco-translate-data-master/Scenarios_full'
      : 'magireco-source-master/Scenarios_full';
    return `${tree}/${parent}/${stem}.json`;
  }

  async function loadStorySection(entry, section) {
    const preferChinese = Boolean(entry.has_cn && byId('full-story-cn')?.checked);
    const languages = preferChinese ? ['cn', 'jp'] : ['jp', 'cn'];
    const errors = [];

    for (const language of languages) {
      if (language === 'cn' && !entry.has_cn) continue;
      if (language === 'jp' && !entry.has_jp) continue;
      const path = sourcePath(entry, section, language);
      try {
        const script = await fetchJson(RAW + encodePath(path), CONFIG.maxStoryBytes);
        if (!script?.story || typeof script.story !== 'object') {
          throw new Error('缺少 story 对象');
        }
        return {
          script,
          language,
          path,
          label: `${storyTitle(entry)} · ${section} · ${language.toUpperCase()}`,
        };
      } catch (error) {
        errors.push(`${language.toUpperCase()}: ${error instanceof Error ? error.message : error}`);
      }
    }
    throw new Error(errors.join('；') || '没有可用语言版本');
  }

  async function loadCatalogIndex() {
    if (catalog.loaded) return catalog.all;
    if (catalog.loading) return catalog.loading;

    catalog.loading = (async () => {
      status('正在读取全剧情目录……');
      const payload = await fetchJson(
        RAW + encodePath(CONFIG.storyIndex),
        CONFIG.maxIndexBytes,
      );
      if (!Array.isArray(payload)) throw new Error('剧情目录不是数组');

      catalog.all = payload
        .filter((entry) =>
          entry &&
          entry.game !== 'exedra' &&
          Array.isArray(entry.sections) &&
          entry.sections.length > 0 &&
          entry.source_identity
        )
        .sort((left, right) => collator.compare(storyTitle(left), storyTitle(right)));

      const categoryNode = byId('full-story-category');
      if (categoryNode) {
        const categories = [...new Set(catalog.all.map((entry) => entry.category).filter(Boolean))]
          .sort(collator.compare);
        for (const category of categories) {
          categoryNode.append(new Option(category, category));
        }
      }

      catalog.loaded = true;
      renderCatalog();
      status(`目录就绪：${catalog.all.length.toLocaleString()} 部剧情`);
      return catalog.all;
    })().finally(() => {
      catalog.loading = null;
    });

    return catalog.loading;
  }

  function installCatalogUi() {
    if (byId('full-story-catalog')) return;
    const panels = document.querySelectorAll('.global_quest_page .bg_change_img');
    if (panels.length < 2) return;

    panels[0].innerHTML = `
      <img src="./image/image_web/common/frame/frame_title.png" class="frame_title full-title">
      <div class="bg_change_font">剧情目录</div>
      <div id="full-story-catalog">
        <label>搜索
          <input id="full-story-search" type="search" placeholder="编号 / 标题 / 文件夹">
        </label>
        <label>分类
