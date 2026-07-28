(function () {
  'use strict';

  const R2 = 'https://pub-70a248f1a6fe4ca597e7a10f8b95dfd8.r2.dev';
  const POLL_MS = 50;
  const VOICE_TIMEOUT_MS = 120000;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function dialogueOf(player, step) {
    try {
      const selected = player.selectDialogue?.(step);
      if (selected) {
        const raw = String(selected.raw ?? '');
        return {
          position: Number.isInteger(selected.position) ? selected.position : 1,
          speaker: String(selected.name ?? ''),
          text: typeof player.plainText === 'function'
            ? String(player.plainText(raw))
            : raw.replace(/@/g, '\n').replace(/\[[^\]]+\]/g, ''),
        };
      }
    } catch (_) {}
    return null;
  }

  function voiceOf(player, step, dialogue) {
    const direct = step?.voiceFull ?? step?.voiceFullAuto ?? step?.voice;
    if (direct) return String(direct);
    const patches = Array.isArray(step?.chara) ? step.chara : [];
    let actorKey = null;
    try {
      actorKey = player.positions?.get(dialogue?.position ?? 1);
    } catch (_) {}
    const candidate = patches.find((patch) => actorKey !== null && String(patch?.id) === String(actorKey))
      ?? patches.find((patch) => Number(patch?.pos) === Number(dialogue?.position))
      ?? patches.find((patch) => patch?.voiceFull || patch?.voiceFullAuto || patch?.voice);
    const cue = candidate?.voiceFull ?? candidate?.voiceFullAuto ?? candidate?.voice;
    return cue ? String(cue) : null;
  }

  function cueUrl(cue) {
    const value = String(cue || '').replace(/^\/+/, '');
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (/^fullvoice\//i.test(value)) {
      return `${R2}/${value.replace(/_hca\.hca$/i, '').replace(/\.hca$/i, '')}_hca.hca`;
    }
    if (/^section_[^/]+\//i.test(value)) {
      return `${R2}/fullvoice/${value.replace(/_hca\.hca$/i, '').replace(/\.hca$/i, '')}_hca.hca`;
    }
    if (/^vo_full_/i.test(value)) {
      const section = value.match(/^vo_full_([0-9]+)-/)?.[1];
      const path = section ? `section_${section}/${value}` : value;
      return `${R2}/fullvoice/${path.replace(/_hca\.hca$/i, '').replace(/\.hca$/i, '')}_hca.hca`;
    }
    return `${R2}/voice/${value.replace(/_hca\.hca$/i, '').replace(/\.hca$/i, '')}_hca.hca`;
  }

  function trackVoice(bridge, player, generation) {
    return (async () => {
      const deadline = performance.now() + VOICE_TIMEOUT_MS;
      while (generation === player.generation && bridge.isPlaying?.('voice')) {
        if (performance.now() >= deadline) {
          bridge.stop?.('voice');
          return;
        }
        await delay(POLL_MS);
      }
    })();
  }

  function appendImmediateLog(player, dialogue) {
    if (!dialogue?.text) return;
    const key = `${player.groupKey ?? ''}:${player.index}:${dialogue.speaker}:${dialogue.text}`;
    player.__v3ImmediateLogKeys ??= new Set();
    if (player.__v3ImmediateLogKeys.has(key)) return;
    player.__v3ImmediateLogKeys.add(key);

    const body = document.getElementById('full-log-body');
    if (!body) return;
    const row = document.createElement('div');
    const name = document.createElement('strong');
    const text = document.createElement('p');
    name.textContent = dialogue.speaker || '？？？';
    text.textContent = dialogue.text;
    row.append(name, text);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  function install(player) {
    if (!player || player.__storyRuntimeV3SyncPatchInstalled) return;
    player.__storyRuntimeV3SyncPatchInstalled = true;
    const bridge = window.MagirecoHcaPlayer;
    const originalApplyDialogue = player.applyDialogue.bind(player);

    player.applyDialogue = async function synchronizedDialogue(step, generation) {
      const dialogue = dialogueOf(this, step);
      appendImmediateLog(this, dialogue);

      const cue = voiceOf(this, step, dialogue);
      if (cue && bridge) {
        const url = cueUrl(cue);
        try {
          bridge.unlock?.();
          if (!bridge.isPlaying?.('voice')) {
            await bridge.play('voice', url, { loop: false });
          }
          this.__v3VoiceCue = cue;
          this.__v3VoiceReady = trackVoice(bridge, this, generation);
        } catch (error) {
          this.__v3VoiceReady = Promise.resolve();
          console.error('[STORY V3 SYNC] voice start failed', cue, error);
        }
      }

      return originalApplyDialogue(step, generation);
    };

    console.info('[STORY V3 SYNC] immediate backlog and pre-dialogue voice installed');
  }

  function boot() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const player = window.MagirecoFullStory?.player;
      if (player?.__storyRuntimeV3Installed) {
        clearInterval(timer);
        install(player);
      } else if (attempts >= 600) {
        clearInterval(timer);
        console.error('[STORY V3 SYNC] player did not initialize');
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
