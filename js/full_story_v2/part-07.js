      if (!effect || generation !== this.generation) return;
      const duration = Math.max(0, finite(seconds, 0.3) * 1000);
      const overlay = byId('advTransition') || byId('full-screen-fx');
      const normalized = String(effect).toLowerCase();

      if (normalized.includes('roll')) {
        overlay.style.background = '#000';
        overlay.animate(
          phase === 'out'
            ? [{ transform: 'translateX(100%)', opacity: 1 }, { transform: 'translateX(0)', opacity: 1 }]
            : [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-100%)', opacity: 1 }],
          { duration, easing: normalized.includes('fast') ? 'cubic-bezier(.7,0,1,1)' : 'ease-in-out' },
        );
      } else {
        overlay.style.background = normalized.includes('white') ? '#fff' : '#000';
        overlay.animate(
          phase === 'out'
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 1 }, { opacity: 0 }],
          { duration, easing: 'ease-in-out' },
        );
      }
      await delay(duration);
    }

    appendLog(name, text) {
      if (!text) return;
      const row = document.createElement('div');
      const nameNode = document.createElement('strong');
      const textNode = document.createElement('p');
      nameNode.textContent = name || '';
      textNode.textContent = text;
      row.append(nameNode, textNode);
      byId('full-log-body').append(row);
    }

    hideDialogue() {
      for (const suffix of ['l', 'c', 'r']) {
        for (const prefix of ['story_name_', 'story_context_', 'story_log_ui_']) {
          const node = byId(prefix + suffix);
          if (node) node.style.display = 'none';
        }
      }
    }

    waitsForClick(step) {
      if (Array.isArray(step.select) && step.select.length) return true;
      if (CLICK_FIELDS.some((field) => step[field] !== undefined)) return true;
      return (step.chara || []).some((patch) =>
        patch.voice !== undefined ||
        patch.voiceFull !== undefined ||
        patch.voiceFullAuto !== undefined
      );
    }

    schedule(step, overrideMs = null) {
      clearTimeout(this.timer);
      this.timer = 0;
      if (!this.playing || this.waitingChoice) return;

      let delayMs = overrideMs;
      if (delayMs === null) {
        if (this.skip) {
          delayMs = 55;
        } else {
          const explicit = step.autoTurnFirst ?? step.autoTurnLast;
          if (Number.isFinite(Number(explicit))) {
            delayMs = Math.max(0, Number(explicit) * 1000);
          } else if (!this.waitsForClick(step)) {
            delayMs = 0;
          } else if (this.auto) {
            const textMs = Math.max(900, this.fullText.length * 55 + CONFIG.autoExtraMs);
            const voiceMs = this.currentVoiceDuration > 0
              ? this.currentVoiceDuration * 1000 + CONFIG.autoExtraMs
              : 0;
            delayMs = Math.max(textMs, voiceMs);
          }
        }
      }

      if (delayMs === null || delayMs === undefined) return;
      const generation = this.generation;
      this.timer = setTimeout(() => {
        this.timer = 0;
        if (generation === this.generation) void this.next();
      }, Math.max(0, delayMs));
    }
  }

  function install() {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = './css/full_story_catalog_v2.css';
    document.head.append(css);

    installStoryOverlay();
    catalog.player = new FullStoryPlayer();
    catalog.oldQuestPage = window.global_quest_page;
    catalog.oldMainPage = window.main_page;

    window.global_quest_page = function fullCatalogQuestPage() {
      if (catalog.player.playing) catalog.player.stop(false);
      catalog.oldQuestPage.apply(this, arguments);
      installCatalogUi();
      void loadCatalogIndex().catch((error) => {
        status(`剧情目录加载失败：${error instanceof Error ? error.message : error}`, true);
      });
    };

    window.start_story = async function startFullStory(entry, section) {
      if (entry && section) {
        const loaded = await loadStorySection(entry, section);
        catalog.player.load(loaded.script, loaded.label, {
          entry,
          section,
          language: loaded.language,
          path: loaded.path,
        });
        return;
      }
      if (catalog.selected) {
        return window.start_story(catalog.selected, catalog.selected.sections[0]);
      }
      const response = await fetch('image/scenario/json/adv/scenario_3/310011-1.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      catalog.player.load(await response.json(), '310011-1 · 本地兼容剧情');
    };

    window.run_story = function runCompatibleStory(steps) {
      catalog.player.load({ story: { group_1: steps } }, '兼容剧情');
    };

    window.main_page = function wrappedMainPage() {
      if (catalog.player.playing) catalog.player.stop(false);
      return catalog.oldMainPage.apply(this, arguments);
    };

    window.MagirecoFullStory = Object.freeze({
      config: CONFIG,
      catalog,
      player: catalog.player,
      loadCatalogIndex,
      loadStorySection,
    });

    console.info('[FULL STORY V2] ready', CONFIG.storyRevision);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
