(function () {
  'use strict';

  const R2 = 'https://pub-70a248f1a6fe4ca597e7a10f8b95dfd8.r2.dev';
  const VOICE_TIMEOUT_MS = 120000;
  const POLL_MS = 50;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeCue(value) {
    if (value === undefined || value === null || value === '') return null;
    return String(value).replace(/^\/+/, '');
  }

  function cueUrl(cue) {
    const value = normalizeCue(cue);
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

  function dialogueOf(player, step) {
    try {
      const selected = player.selectDialogue?.(step);
      if (selected) return selected;
    } catch (_) {}
    const fields = [
      ['textLeft', 0, 'nameLeft'],
      ['textCenter', 1, 'nameCenter'],
      ['textRight', 2, 'nameRight'],
      ['textAvLeft', 0, 'nameLeft'],
      ['textAvCenter', 1, 'nameCenter'],
      ['textAvRight', 2, 'nameRight'],
    ];
    for (const [textField, position, nameField] of fields) {
      if (step && step[textField] !== undefined) {
        return {
          position,
          speaker: String(step[nameField] ?? ''),
          text: String(step[textField] ?? '').replace(/@/g, '\n'),
        };
      }
    }
    return null;
  }

  function voiceOf(player, step) {
    const direct = normalizeCue(step?.voiceFull ?? step?.voiceFullAuto ?? step?.voice);
    if (direct) return direct;
    const patches = Array.isArray(step?.chara) ? step.chara : [];
    const dialogue = dialogueOf(player, step);
    const position = Number.isInteger(dialogue?.position) ? Number(dialogue.position) : null;
    let actorKey = null;
    try {
      actorKey = position === null ? null : player.positions?.get(position);
    } catch (_) {}
    const candidate = patches.find((patch) => actorKey !== null && String(patch?.id) === String(actorKey))
      ?? patches.find((patch) => position !== null && Number(patch?.pos) === position)
      ?? patches.find((patch) => patch?.voiceFull || patch?.voiceFullAuto || patch?.voice);
    return normalizeCue(candidate?.voiceFull ?? candidate?.voiceFullAuto ?? candidate?.voice);
  }

  function waitForVoice(bridge, generation, player) {
    return (async () => {
      const deadline = performance.now() + VOICE_TIMEOUT_MS;
      while (generation === player.generation && bridge.isPlaying?.('voice')) {
        if (performance.now() >= deadline) {
          bridge.stop?.('voice');
          console.warn('[STORY V3] voice timeout');
          return;
        }
        await delay(POLL_MS);
      }
    })();
  }

  function appendBacklog(player, step) {
    const dialogue = dialogueOf(player, step);
    if (!dialogue?.text) return;
    const speaker = String(dialogue.speaker ?? dialogue.name ?? '');
    const text = String(dialogue.text).replace(/@/g, '\n');
    const key = `${player.group ?? ''}:${player.index}:${speaker}:${text}`;
    player.__v3BacklogKeys ??= new Set();
    if (player.__v3BacklogKeys.has(key)) return;
    player.__v3BacklogKeys.add(key);
    player.__v3Backlog ??= [];
    player.__v3Backlog.push({ speaker, text, index: player.index, group: player.group ?? '' });

    const body = document.getElementById('full-log-body');
    if (!body) return;
    const row = document.createElement('div');
    const name = document.createElement('strong');
    const line = document.createElement('p');
    name.textContent = speaker || '？？？';
    line.textContent = text;
    row.append(name, line);
    body.appendChild(row);
  }

  function replaceControl(id, handler) {
    const oldNode = document.getElementById(id);
    if (!oldNode?.parentNode) return null;
    const node = oldNode.cloneNode(true);
    oldNode.parentNode.replaceChild(node, oldNode);
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    const invoke = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handler(node);
    };
    node.addEventListener('click', invoke, true);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') invoke(event);
    }, true);
    return node;
  }

  function install(player) {
    if (!player || player.__storyRuntimeV3Installed) return;
    player.__storyRuntimeV3Installed = true;
    player.__v3VoiceReady = Promise.resolve();
    player.__v3VoiceCue = null;

    const bridge = window.MagirecoHcaPlayer;
    if (!bridge) {
      console.error('[STORY V3] MagirecoHcaPlayer is unavailable');
    }

    const unlock = () => {
      try { bridge?.unlock?.(); } catch (_) {}
    };
    for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
      document.addEventListener(eventName, unlock, { capture: true, passive: true });
    }

    const originalApplyDialogue = typeof player.applyDialogue === 'function'
      ? player.applyDialogue.bind(player)
      : async () => undefined;
    player.applyDialogue = async function patchedApplyDialogue(step, generation) {
      const result = await originalApplyDialogue(step, generation);
      appendBacklog(this, step);
      const cue = voiceOf(this, step);
      if (!cue || !bridge) {
        this.__v3VoiceReady = Promise.resolve();
        return result;
      }
      const url = cueUrl(cue);
      if (!url) return result;
      if (this.__v3VoiceCue === cue && bridge.isPlaying?.('voice')) return result;
      this.__v3VoiceCue = cue;
      try {
        unlock();
        await bridge.play('voice', url, { loop: false });
        this.__v3VoiceReady = waitForVoice(bridge, generation, this);
      } catch (error) {
        this.__v3VoiceReady = Promise.resolve();
        console.error('[STORY V3] voice playback failed', cue, error);
      }
      return result;
    };

    const originalStop = typeof player.stop === 'function' ? player.stop.bind(player) : () => undefined;
    player.stop = function patchedStop() {
      try { bridge?.stop?.('voice'); } catch (_) {}
      this.__v3VoiceCue = null;
      this.__v3VoiceReady = Promise.resolve();
      return originalStop(...arguments);
    };

    player.schedule = function scheduleWithVoice(step, forcedDelay) {
      clearTimeout(this.timer);
      this.timer = 0;
      if (!this.playing || this.waitingChoice || this.awaitingChoice) return;
      const explicit = Number(step?.autoTurnFirst ?? step?.autoTurnLast);
      const shouldAdvance = this.skip || this.auto || this.autoEnabled || Number.isFinite(explicit) || forcedDelay !== undefined;
      if (!shouldAdvance) return;
      const generation = this.generation;
      const dialogue = dialogueOf(this, step);
      const textLength = String(dialogue?.text ?? '').replace(/\[[^\]]+\]/g, '').length;
      const speed = Math.max(0.25, Number(this.speed ?? this.playbackRate ?? 1) || 1);
      let delayMs;
      if (this.skip) delayMs = 45;
      else if (forcedDelay !== undefined) delayMs = Math.max(0, Number(forcedDelay) || 0);
      else if (Number.isFinite(explicit)) delayMs = Math.max(120, explicit * 1000 / speed);
      else delayMs = Math.max(900, (textLength * 55 + 600) / speed);
      const textReady = delay(delayMs);
      const voiceReady = this.__v3VoiceReady ?? Promise.resolve();
      void Promise.allSettled([textReady, voiceReady]).then(() => {
        if (generation === this.generation && this.playing && !this.waitingChoice && !this.awaitingChoice) {
          void this.next();
        }
      });
    };

    const updateButtons = () => {
      document.getElementById('story_auto')?.classList.toggle('full-active', Boolean(player.auto || player.autoEnabled));
      document.getElementById('story_skip')?.classList.toggle('full-active', Boolean(player.skip));
      document.getElementById('story_auto')?.setAttribute('aria-pressed', String(Boolean(player.auto || player.autoEnabled)));
      document.getElementById('story_skip')?.setAttribute('aria-pressed', String(Boolean(player.skip)));
    };

    replaceControl('story_auto', () => {
      unlock();
      const next = !(player.auto || player.autoEnabled);
      player.auto = next;
      player.autoEnabled = next;
      if (next) player.skip = false;
      updateButtons();
      if (next && player.playing && !player.busy && !player.waitingChoice && !player.awaitingChoice) {
        player.schedule(player.steps?.[player.index] ?? {});
      } else if (!next && player.timer) {
        clearTimeout(player.timer);
        player.timer = 0;
      }
    });

    replaceControl('story_skip', () => {
      unlock();
      player.skip = !player.skip;
      if (player.skip) {
        player.auto = false;
        player.autoEnabled = false;
      }
      updateButtons();
      if (player.skip && player.playing && !player.busy && !player.waitingChoice && !player.awaitingChoice) {
        player.schedule(player.steps?.[player.index] ?? {}, 45);
      }
    });

    replaceControl('story_log', () => {
      const log = document.getElementById('full-log');
      if (!log) {
        console.error('[STORY V3] LOG panel is unavailable');
        return;
      }
      log.hidden = !log.hidden;
      if (!log.hidden) {
        const body = document.getElementById('full-log-body');
        if (body) body.scrollTop = body.scrollHeight;
      }
    });

    const close = document.getElementById('full-log-close');
    if (close) {
      const replacement = close.cloneNode(true);
      close.parentNode?.replaceChild(replacement, close);
      replacement.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const log = document.getElementById('full-log');
        if (log) log.hidden = true;
      }, true);
    }

    updateButtons();
    console.info('[STORY V3] voice, AUTO, SKIP and LOG runtime installed');
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
        console.error('[STORY V3] player did not initialize');
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
