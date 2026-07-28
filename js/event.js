(function () {
  'use strict';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error('Unable to load ' + src));
      };
      document.head.appendChild(script);
    });
  }

  var legacy = 'https://rawcdn.githack.com/HiiragiNemu/magireco_viewerSP/e0cee52ae5e9db1a97df50718260a5966de594fc/js/event.js';
  loadScript(legacy)
    .then(function () { return loadScript('./js/full_story_fetch_patch.js'); })
    .then(function () { return loadScript('./js/hca/hca_audio.js'); })
    .then(function () { return loadScript('./js/full_story_catalog_v2_loader.js'); })
    .then(function () { return window.__MagirecoFullStoryV2Ready; })
    .then(function () { return loadScript('./js/full_story_reliability_patch.js'); })
    .then(function () { return loadScript('./js/story_runtime_v3.js'); })
    .then(function () { return loadScript('./js/story_runtime_v3_sync_patch.js'); })
    .then(function () { return loadScript('./js/story_runtime_v3_layer_patch.js'); })
    .then(function () {
      if (window.__installMagirecoReliabilityPatch) window.__installMagirecoReliabilityPatch();
      window.dispatchEvent(new CustomEvent('magireco:full-story-ready'));
    })
    .catch(function (error) {
      console.error('[FULL STORY BOOT]', error);
      alert('剧情运行时加载失败：' + error.message);
    });
})();
