(function () {
  'use strict';

  function install() {
    const runtime = window.MagirecoFullStory;
    const player = runtime && runtime.player;
    if (!player || player.__reliabilityPatchInstalled) return;
    player.__reliabilityPatchInstalled = true;

    let lipSyncFrame = 0;
    let lipSyncRecord = null;
    let smoothedMouth = 0;

    function setMouth(record, value) {
      try {
        record && record.sprite && record.sprite.internalModel &&
          record.sprite.internalModel.coreModel &&
          record.sprite.internalModel.coreModel.setParameterValueById(
            'ParamMouthOpenY',
            Math.max(0, Math.min(1, value)),
          );
      } catch (_) {}
    }

    function stopLipSync() {
      if (lipSyncFrame) cancelAnimationFrame(lipSyncFrame);
      lipSyncFrame = 0;
      if (lipSyncRecord) setMouth(lipSyncRecord, 0);
      lipSyncRecord = null;
      smoothedMouth = 0;
    }

    function startLipSync(record, generation) {
      const bridge = window.MagirecoHcaPlayer;
      if (!record || !bridge || typeof bridge.getLevel !== 'function') return false;
      stopLipSync();
      lipSyncRecord = record;
      const tick = () => {
        if (
          generation !== player.generation ||
          !bridge.isPlaying ||
          !bridge.isPlaying('voice')
        ) {
          stopLipSync();
          return;
        }
        const rms = Math.max(0, Number(bridge.getLevel('voice')) || 0);
        const target = Math.max(0, Math.min(1, (rms - 0.004) * 10.5));
        smoothedMouth = smoothedMouth * 0.58 + target * 0.42;
        setMouth(record, smoothedMouth);
        lipSyncFrame = requestAnimationFrame(tick);
      };
      lipSyncFrame = requestAnimationFrame(tick);
      return true;
    }

    function isLive2dChild(child) {
      return Boolean(
        child && (
          child.internalModel ||
          child.__magirecoStoryModel ||
          /Live2D/i.test(String(child.constructor && child.constructor.name))
        )
      );
    }

    function clearUntrackedStageModels() {
      const stage = window.app && window.app.stage;
      if (!stage || !Array.isArray(stage.children)) return;
      const tracked = new Set(
        [...player.models.values()].map((record) => record && record.sprite).filter(Boolean),
      );
      for (const child of [...stage.children]) {
        if (!isLive2dChild(child) || tracked.has(child)) continue;
        try { stage.removeChild(child); } catch (_) {}
        try { child.destroy({ children: true }); } catch (_) {}
      }
    }

    const originalStop = player.stop.bind(player);
    player.stop = function patchedStop(backToQuest) {
      stopLipSync();
      clearUntrackedStageModels();
      return originalStop(backToQuest);
    };

    const originalLoad = player.load.bind(player);
    player.load = function patchedLoad(script, label, metadata) {
      clearUntrackedStageModels();
      const result = originalLoad(script, label, metadata);
      clearUntrackedStageModels();
      return result;
    };

    const originalUpdateState = player.updateState.bind(player);
    player.updateState = function patchedUpdateState(step) {
      const patches = Array.isArray(step && step.chara) ? step.chara : [];
      const explicitSceneRoster = Boolean(
        step && step.turnChangeIn && patches.length &&
        patches.every((patch) =>
          patch && patch.id !== undefined && (
            patch.pos !== undefined ||
            /fadeout|hide|disappear|remove/i.test(String(patch.effect || ''))
          )
        )
      );

      if (explicitSceneRoster) {
        const keep = new Set(
          patches
            .filter((patch) => !/fadeout|hide|disappear|remove/i.test(String(patch.effect || '')))
            .map((patch) => String(patch.id)),
        );
        for (const key of [...this.models.keys()]) {
          if (!keep.has(key)) this.removeModel(key);
        }
        for (const key of [...this.state.characters.keys()]) {
          if (!keep.has(key)) this.state.characters.delete(key);
        }
      }

      originalUpdateState(step);

      for (const patch of patches) {
        if (!patch || patch.id === undefined) continue;
        if (/fadeout|hide|disappear|remove/i.test(String(patch.effect || ''))) {
          this.state.characters.delete(String(patch.id));
        }
      }
    };

    const originalApplyDialogue = player.applyDialogue.bind(player);
    player.applyDialogue = async function patchedApplyDialogue(step, generation) {
      stopLipSync();
      const dialogue = this.selectDialogue(step);
      const position = dialogue && Number.isInteger(dialogue.position) ? dialogue.position : null;
      const key = position === null ? null : this.positions.get(position);
      const record = key ? this.models.get(key) : null;
      const bridge = window.MagirecoHcaPlayer;
      const hasDecodedVoice = Boolean(bridge && bridge.isPlaying && bridge.isPlaying('voice'));

      if (!record || !hasDecodedVoice) return originalApplyDialogue(step, generation);

      const sprite = record.sprite;
      const originalStart = sprite.start_m;
      const originalStopMouth = sprite.stop_m;
      sprite.start_m = () => { startLipSync(record, generation); };
      sprite.stop_m = () => {
        if (!bridge.isPlaying('voice')) stopLipSync();
      };
      try {
        return await originalApplyDialogue(step, generation);
      } finally {
        sprite.start_m = originalStart;
        sprite.stop_m = originalStopMouth;
        if (!bridge.isPlaying('voice')) stopLipSync();
      }
    };

    function replaceControl(id, handler) {
      const oldNode = document.getElementById(id);
      if (!oldNode || !oldNode.parentNode) return null;
      const node = oldNode.cloneNode(true);
      oldNode.parentNode.replaceChild(node, oldNode);
      node.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        handler(event, node);
      }, true);
      return node;
    }

    replaceControl('story_auto', () => {
      player.auto = !player.auto;
      if (player.auto) player.skip = false;
      player.updateButtons();
      if (player.auto && player.playing && !player.busy && !player.waitingChoice) {
        player.schedule(player.steps[player.index] || {});
      } else if (!player.auto && player.timer) {
        clearTimeout(player.timer);
        player.timer = 0;
      }
    });

    replaceControl('story_skip', () => {
      player.skip = !player.skip;
      if (player.skip) player.auto = false;
      player.fastForwardText = player.skip;
      player.updateButtons();
      if (player.skip && player.playing && !player.busy && !player.waitingChoice) {
        player.schedule(player.steps[player.index] || {}, 45);
      }
    });

    replaceControl('story_log', () => {
      const log = document.getElementById('full-log');
      if (!log) return;
      log.hidden = !log.hidden;
      if (!log.hidden) {
        const body = document.getElementById('full-log-body');
        if (body) body.scrollTop = body.scrollHeight;
      }
    });

    const close = document.getElementById('full-log-close');
    if (close && !close.__reliabilityPatchBound) {
      close.__reliabilityPatchBound = true;
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        document.getElementById('full-log').hidden = true;
      }, true);
    }

    player.updateButtons();
    window.addEventListener('beforeunload', () => {
      stopLipSync();
      if (window.MagirecoHcaPlayer && window.MagirecoHcaPlayer.stopAll) {
        window.MagirecoHcaPlayer.stopAll();
      }
    }, { once: true });

    console.info('[FULL STORY RELIABILITY] voice, lifecycle, LOG and AUTO fixes installed');
  }

  if (window.MagirecoFullStory) install();
  else window.addEventListener('magireco:full-story-ready', install, { once: true });
  window.__installMagirecoReliabilityPatch = install;
})();
