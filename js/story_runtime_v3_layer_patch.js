(function () {
  'use strict';

  function install(player) {
    if (!player || player.__storyRuntimeV3LayerPatchInstalled) return;
    player.__storyRuntimeV3LayerPatchInstalled = true;

    const hidden = new Map();
    let loading = false;

    function storyControlsOnTop() {
      const storyPage = document.querySelector('.story_page');
      if (storyPage) {
        storyPage.style.pointerEvents = 'auto';
      }
      for (const id of ['story_log', 'story_auto', 'story_skip']) {
        const node = document.getElementById(id);
        if (!node) continue;
        node.style.zIndex = '10000';
        node.style.pointerEvents = 'auto';
        node.style.cursor = 'pointer';
      }
      const log = document.getElementById('full-log');
      if (log) log.style.zIndex = '11000';
      const choices = document.getElementById('full-choices');
      if (choices) choices.style.zIndex = '11000';
    }

    function hideNonStoryLayers() {
      const selectors = [
        '.main:not(#canvas)',
        '.char',
        '.voice',
        '.global_quest_page',
        '.setting:not(#back_main)',
      ];
      for (const node of document.querySelectorAll(selectors.join(','))) {
        if (!(node instanceof HTMLElement)) continue;
        if (!hidden.has(node)) hidden.set(node, node.style.display);
        node.style.display = 'none';
        node.style.pointerEvents = 'none';
      }
      const canvas = document.getElementById('canvas');
      if (canvas instanceof HTMLElement) {
        canvas.style.display = 'block';
        canvas.style.pointerEvents = 'none';
      }
      const page = document.querySelector('.story_page');
      if (page instanceof HTMLElement) page.style.display = 'block';
      storyControlsOnTop();
    }

    function restoreNonStoryLayers() {
      for (const [node, display] of hidden) {
        if (!node.isConnected) continue;
        node.style.display = display;
        node.style.pointerEvents = '';
      }
      hidden.clear();
    }

    const originalLoad = player.load.bind(player);
    player.load = function patchedLayerLoad() {
      loading = true;
      try {
        const result = originalLoad(...arguments);
        hideNonStoryLayers();
        requestAnimationFrame(hideNonStoryLayers);
        return result;
      } finally {
        loading = false;
      }
    };

    const originalStop = player.stop.bind(player);
    player.stop = function patchedLayerStop() {
      const result = originalStop(...arguments);
      if (!loading) restoreNonStoryLayers();
      return result;
    };

    const originalFinish = typeof player.finish === 'function' ? player.finish.bind(player) : null;
    if (originalFinish) {
      player.finish = function patchedLayerFinish() {
        const result = originalFinish(...arguments);
        storyControlsOnTop();
        return result;
      };
    }

    window.addEventListener('resize', storyControlsOnTop, { passive: true });
    console.info('[STORY V3 LAYERS] non-story pointer interception removed');
  }

  function boot() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const player = window.MagirecoFullStory?.player;
      if (player) {
        clearInterval(timer);
        install(player);
      } else if (attempts >= 600) {
        clearInterval(timer);
        console.error('[STORY V3 LAYERS] player did not initialize');
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
