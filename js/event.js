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
    .then(function () { return loadScript('./js/full_story_catalog.js'); })
    .catch(function (error) {
      console.error('[FULL STORY BOOT]', error);
      alert('剧情运行时加载失败：' + error.message);
    });
})();
