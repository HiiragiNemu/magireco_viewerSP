          <select id="full-story-category"><option value="">全部分类</option></select>
        </label>
        <label class="full-check">
          <input id="full-story-cn" type="checkbox" checked>
          优先中文，缺失时回退日文
        </label>
        <div class="full-pages">
          <button id="full-prev" type="button">上一页</button>
          <span id="full-page">1 / 1</span>
          <button id="full-next" type="button">下一页</button>
        </div>
        <div id="full-story-status">等待目录。</div>
      </div>`;

    const list = panels[1].querySelector('.quest_list');
    if (!list) return;
    list.id = 'full-story-list';
    list.replaceChildren();
    const heading = panels[1].querySelector('.bg_change_font');
    if (heading) heading.textContent = '全剧情';

    byId('full-story-search').addEventListener('input', () => {
      catalog.page = 0;
      renderCatalog();
    });
    byId('full-story-category').addEventListener('change', () => {
      catalog.page = 0;
      renderCatalog();
    });
    byId('full-prev').addEventListener('click', () => {
      catalog.page = Math.max(0, catalog.page - 1);
      renderCatalog();
    });
    byId('full-next').addEventListener('click', () => {
      catalog.page += 1;
      renderCatalog();
    });
  }

  function renderCatalog() {
    const root = byId('full-story-list');
    if (!root) return;
    const query = normalizedText(byId('full-story-search')?.value);
    const category = byId('full-story-category')?.value || '';

    catalog.filtered = catalog.all.filter((entry) => {
      if (category && entry.category !== category) return false;
      if (!query) return true;
      return normalizedText(
        `${entry.id} ${entry.raw_id || ''} ${entry.title || ''} ${entry.folder || ''} ${entry.source_identity}`
      ).includes(query);
    });

    const pages = Math.max(1, Math.ceil(catalog.filtered.length / CONFIG.pageSize));
    catalog.page = Math.max(0, Math.min(catalog.page, pages - 1));
    root.replaceChildren();

    const start = catalog.page * CONFIG.pageSize;
    for (const entry of catalog.filtered.slice(start, start + CONFIG.pageSize)) {
      root.append(createStoryRow(entry));
    }

    byId('full-page').textContent = `${catalog.page + 1} / ${pages}`;
    byId('full-prev').disabled = catalog.page === 0;
    byId('full-next').disabled = catalog.page >= pages - 1;
    status(`匹配 ${catalog.filtered.length.toLocaleString()} 部剧情`);
  }

  function createStoryRow(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'quest_btn full-story';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'quest_btn_2 full-story-head';
    header.innerHTML = `
      <img class="quest_btn_2_img" src="./image/image_web/common/frame/title_icon.png">
      <span class="quest_btn_2_t"></span>
      <img class="quest_btn_2_img2" src="./image/image_web/page/quest/btn_list_close.png">`;
    header.querySelector('span').textContent = storyTitle(entry);

    const sections = document.createElement('div');
    sections.className = 'full-sections';
    sections.hidden = true;

    header.addEventListener('click', () => {
      catalog.selected = entry;
      sections.hidden = !sections.hidden;
      wrapper.classList.toggle('open', !sections.hidden);
      if (!sections.childElementCount) {
        entry.sections.forEach((section, index) => {
          sections.append(createSectionButton(entry, section, index));
        });
      }
    });

    wrapper.append(header, sections);
    return wrapper;
  }

  function createSectionButton(entry, section, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'full-section';
    button.innerHTML = `
      <b>${String(index + 1).padStart(2, '0')}</b>
      <span></span>
      <small>${entry.has_cn ? 'CN/JP' : 'JP'}</small>`;
    button.querySelector('span').textContent = section;

    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      button.disabled = true;
      status(`正在载入 ${entry.id} / ${section}……`);
      try {
        const loaded = await loadStorySection(entry, section);
        catalog.player.load(loaded.script, loaded.label, {
          entry,
          section,
          language: loaded.language,
          path: loaded.path,
        });
        status(`已载入 ${loaded.label}`);
      } catch (error) {
        status(`载入失败：${error instanceof Error ? error.message : error}`, true);
      } finally {
        button.disabled = false;
      }
    });

    return button;
  }

  function installStoryOverlay() {
    if (byId('full-story-overlay')) return;
    const storyPage = document.querySelector('.story_page');
    if (!storyPage) throw new Error('找不到原版 story_page');

    const overlay = document.createElement('div');
    overlay.id = 'full-story-overlay';
    overlay.innerHTML = `
      <canvas id="full-fx"></canvas>
      <div id="full-items"></div>
      <div id="full-screen-fx"></div>
      <div id="full-narration" hidden>
        <strong id="full-narration-name"></strong>
        <div id="full-narration-text"></div>
      </div>
      <div id="full-choices" hidden></div>
      <div id="full-progress"></div>
      <div id="full-log" hidden>
        <header>LOG<button id="full-log-close" type="button">×</button></header>
        <main id="full-log-body"></main>
      </div>`;
    storyPage.append(overlay);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function firstDefined(object, keys) {
    for (const key of keys) {
      if (object[key] !== undefined) return object[key];
    }
    return undefined;
  }

  function audioCandidates(channel, cue) {
    const value = String(cue || '').replace(/_hca\.hca$/i, '').replace(/\.(hca|mp3|ogg|wav)$/i, '');
    const r2 = CONFIG.assetBase;
    if (channel === 'bgm') {
      return [
        `${r2}/bgm/${encodeURIComponent(value)}_hca.hca`,
        `./image/sound_native/bgm/${value}.mp3`,
      ];
    }
    if (channel === 'jingle') {
      return [
        `${r2}/jingle/${encodeURIComponent(value)}_hca.hca`,
        `./image/sound_native/jingle/${value}.mp3`,
      ];
    }
    if (channel === 'se' || channel === 'surround') {
      return [
        `${r2}/surround/${encodeURIComponent(value)}_hca.hca`,
        `./image/sound_native/se/${value}.mp3`,
      ];
    }
    if (channel === 'voiceFull') {
      const encoded = value.split('/').map(encodeURIComponent).join('/');
      return [
        `${r2}/fullvoice/${encoded}_hca.hca`,
