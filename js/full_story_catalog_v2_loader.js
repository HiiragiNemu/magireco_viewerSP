(function () {
  'use strict';

  const parts = Array.from({ length: 8 }, (_, index) =>
    `./js/full_story_v2/part-${String(index).padStart(2, '0')}.js`
  );

  window.__MagirecoFullStoryV2Ready = (async () => {
    const sourceParts = [];
    for (const path of parts) {
      const response = await fetch(path, { cache: 'no-cache', credentials: 'omit' });
      if (!response.ok) throw new Error(`Full-story runtime part failed ${response.status}: ${path}`);
      sourceParts.push(await response.text());
    }

    const source = sourceParts.join('') + '\n//# sourceURL=full_story_catalog_v2.js\n';
    const blob = new Blob([source], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = false;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Full-story runtime v2 execution failed'));
        document.head.appendChild(script);
      });
      return window.MagirecoFullStory;
    } finally {
      URL.revokeObjectURL(url);
    }
  })().catch((error) => {
    console.error('[FULL STORY V2 LOADER]', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = document.getElementById('full-story-status');
    if (status) {
      status.textContent = `全剧情运行时加载失败：${message}`;
      status.classList.add('bad');
    } else {
      alert(`全剧情运行时加载失败：${message}`);
    }
    throw error;
  });
})();
