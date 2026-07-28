(function () {
  'use strict';

  const POSITION_X = [120, 850, 1580];

  function install() {
    const runtime = window.MagirecoFullStory;
    const player = runtime && runtime.player;
    if (!player || player.__localModelPatchInstalled) return;
    player.__localModelPatchInstalled = true;

    const originalEnsureModel = player.ensureModel.bind(player);

    player.ensureModel = async function ensureLocalModelFirst(key, position, generation) {
      const normalizedKey = String(key);
      const normalizedPosition = Math.max(0, Math.min(2, Number(position) || 0));
      const existing = this.models.get(normalizedKey);
      if (existing) return existing;

      const occupied = this.positions.get(normalizedPosition);
      if (occupied && occupied !== normalizedKey) this.removeModel(occupied);

      const localBase = `./image/image_native/live2d_v4/${normalizedKey}/`;
      try {
        const sprite = await window.show2(localBase, 'model.model3.json', POSITION_X[normalizedPosition]);
        if (generation !== this.generation) {
          try { sprite.destroy({ children: true }); } catch (_) {}
          return null;
        }
        sprite.__magirecoStoryModel = true;
        const record = {
          key: normalizedKey,
          position: normalizedPosition,
          sprite,
          base: localBase,
        };
        this.models.set(normalizedKey, record);
        this.positions.set(normalizedPosition, normalizedKey);
        this.modelFailures.delete(normalizedKey);
        return record;
      } catch (localError) {
        console.warn('[FULL STORY LOCAL MODEL]', normalizedKey, localError);
      }

      return originalEnsureModel(normalizedKey, normalizedPosition, generation);
    };

    console.info('[FULL STORY LOCAL MODEL] local-first model loading installed');
  }

  if (window.MagirecoFullStory) install();
  else window.addEventListener('magireco:full-story-ready', install, { once: true });
  window.__installMagirecoLocalModelPatch = install;
})();
