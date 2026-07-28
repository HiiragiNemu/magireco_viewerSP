(function () {
  'use strict';

  function replaceSkip(player) {
    if (!player || player.__storyRuntimeV3SkipRestoreInstalled) return;
    const oldNode = document.getElementById('story_skip');
    if (!oldNode?.parentNode) return;
    player.__storyRuntimeV3SkipRestoreInstalled = true;

    const node = oldNode.cloneNode(true);
    oldNode.parentNode.replaceChild(node, oldNode);
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-pressed', String(Boolean(player.skip)));

    let restoreAuto = Boolean(player.auto || player.autoEnabled);

    const update = () => {
      node.classList.toggle('full-active', Boolean(player.skip));
      node.setAttribute('aria-pressed', String(Boolean(player.skip)));
      const autoNode = document.getElementById('story_auto');
      autoNode?.classList.toggle('full-active', Boolean(player.auto || player.autoEnabled));
      autoNode?.setAttribute('aria-pressed', String(Boolean(player.auto || player.autoEnabled)));
    };

    const toggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      try { window.MagirecoHcaPlayer?.unlock?.(); } catch (_) {}

      if (!player.skip) {
        restoreAuto = Boolean(player.auto || player.autoEnabled);
        player.skip = true;
        player.auto = false;
        player.autoEnabled = false;
        update();
        if (player.playing && !player.busy && !player.waitingChoice && !player.awaitingChoice) {
          player.schedule(player.steps?.[player.index] ?? {}, 45);
        }
        return;
      }

      player.skip = false;
      player.auto = restoreAuto;
      player.autoEnabled = restoreAuto;
      update();
      if (restoreAuto && player.playing && !player.busy && !player.waitingChoice && !player.awaitingChoice) {
        player.schedule(player.steps?.[player.index] ?? {});
      }
    };

    node.addEventListener('click', toggle, true);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') toggle(event);
    }, true);
    update();
    console.info('[STORY V3 SKIP] AUTO state restoration installed');
  }

  function boot() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const player = window.MagirecoFullStory?.player;
      if (player?.__storyRuntimeV3Installed) {
        clearInterval(timer);
        replaceSkip(player);
      } else if (attempts >= 600) {
        clearInterval(timer);
        console.error('[STORY V3 SKIP] player did not initialize');
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
