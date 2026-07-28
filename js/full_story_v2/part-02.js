        `./image/sound_native/fullvoice/${value}.mp3`,
      ];
    }
    return [
      `${r2}/voice/${encodeURIComponent(value)}_hca.hca`,
      `./image/sound_native/voice/${value}.mp3`,
    ];
  }

  class AudioBus {
    constructor() {
      this.slots = new Map();
      this.currentBgm = null;
      this.lastWarning = new Set();
    }

    stop(channel) {
      const slot = this.slots.get(channel);
      if (slot) {
        try {
          if (slot.stop) slot.stop();
          else {
            slot.pause();
            slot.currentTime = 0;
            slot.removeAttribute('src');
            slot.load();
          }
        } catch (_) {}
        this.slots.delete(channel);
      }
      if (channel === 'bgm') this.currentBgm = null;
    }

    stopAll() {
      for (const channel of [...this.slots.keys()]) this.stop(channel);
    }

    async play(channel, cue, options = {}) {
      if (!cue || cue === 'stop') {
        this.stop(channel);
        return { duration: 0, played: false };
      }
      if (channel === 'bgm' && this.currentBgm === cue) {
        return { duration: Infinity, played: true };
      }

      const candidateChannel = options.kind === 'voiceFull' ? 'voiceFull' : channel;
      const candidates = audioCandidates(candidateChannel, cue);
      const bridge = window.MagirecoHcaPlayer;
      if (bridge && typeof bridge.play === 'function') {
        this.stop(channel);
        try {
          const result = await bridge.play(channel, candidates[0], {
            loop: Boolean(options.loop),
            key: '0x01395C51',
          });
          this.slots.set(channel, {
            stop: () => bridge.stop?.(channel),
          });
          if (channel === 'bgm') this.currentBgm = cue;
          return {
            duration: finite(result?.duration, 0),
            played: true,
          };
        } catch (error) {
          this.warnOnce(`${channel}:${cue}`, error);
        }
      }

      for (const candidate of candidates.slice(1)) {
        try {
          const audio = new Audio(candidate);
          audio.preload = 'auto';
          audio.loop = Boolean(options.loop);
          const ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('audio metadata timeout')), 3500);
            audio.addEventListener('loadedmetadata', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
            audio.addEventListener('error', () => {
              clearTimeout(timer);
              reject(new Error(`audio load failed: ${candidate}`));
            }, { once: true });
          });
          await ready;
          this.stop(channel);
          await audio.play();
          this.slots.set(channel, audio);
          if (channel === 'bgm') this.currentBgm = cue;
          return {
            duration: Number.isFinite(audio.duration) ? audio.duration : 0,
            played: true,
          };
        } catch (_) {
          // Try the next browser-compatible candidate.
        }
      }

      this.warnOnce(`${channel}:${cue}`, new Error('HCA 解码器尚未连接，且没有可播放的转换音频'));
      return { duration: 0, played: false };
    }

    warnOnce(key, error) {
      if (this.lastWarning.has(key)) return;
      this.lastWarning.add(key);
      console.warn('[FULL STORY AUDIO]', key, error);
    }
  }

  class FullStoryPlayer {
    constructor() {
      this.script = null;
      this.groups = {};
      this.groupOrder = [];
      this.groupKey = 'group_1';
      this.steps = [];
      this.index = -1;
      this.generation = 0;
      this.busy = false;
      this.waitingChoice = false;
      this.playing = false;
      this.auto = false;
      this.skip = false;
      this.timer = 0;
      this.typing = false;
      this.fastForwardText = false;
      this.fullText = '';
      this.currentTextNode = null;
      this.currentVoiceDuration = 0;
      this.models = new Map();
      this.positions = new Map();
      this.modelFailures = new Map();
      this.items = new Map();
      this.audio = new AudioBus();
      this.state = this.createState();
      this.metadata = null;
      this.bindUi();
    }

    createState() {
      return {
        bg: null,
        bgm: null,
        names: ['', '', ''],
        avNames: ['', '', ''],
        narrationName: '',
        fnarrationName: '',
        characters: new Map(),
        items: new Map(),
        dialogue: null,
      };
    }

    bindUi() {
      const page = document.querySelector('.story_page');
      page.addEventListener('click', (event) => {
        if (event.target.closest('#full-choices,#full-log,#story_log,#story_auto,#story_skip')) return;
        void this.next();
      });

      $('#story_auto').off('click.fullStory').on('click.fullStory', (event) => {
        event.stopPropagation();
        this.auto = !this.auto;
        if (this.auto) this.skip = false;
        this.updateButtons();
        if (this.auto && this.playing && !this.timer && !this.busy && !this.waitingChoice) {
          this.schedule(this.steps[this.index] || {});
        }
      });

      $('#story_skip').off('click').on('click.fullStory', (event) => {
        event.stopPropagation();
        this.skip = !this.skip;
        if (this.skip) this.auto = false;
        this.fastForwardText = this.skip;
        this.updateButtons();
        if (this.skip && this.playing && !this.busy && !this.waitingChoice) {
          this.schedule(this.steps[this.index] || {}, 45);
        }
      });

      $('#story_log').off('click.fullStory').on('click.fullStory', (event) => {
        event.stopPropagation();
        byId('full-log').hidden = !byId('full-log').hidden;
      });

      byId('full-log-close').addEventListener('click', (event) => {
        event.stopPropagation();
        byId('full-log').hidden = true;
      });
    }

    updateButtons() {
      byId('story_auto').classList.toggle('full-active', this.auto);
      byId('story_skip').classList.toggle('full-active', this.skip);
    }

    load(script, label, metadata = null) {
      this.stop(false);
      this.script = script;
      this.groups = script.story || {};
      this.groupOrder = Object.keys(this.groups)
        .filter((key) => Array.isArray(this.groups[key]))
        .sort(collator.compare);
      if (!this.groupOrder.length) throw new Error('剧情没有可执行 group');
      this.metadata = metadata;
      this.state = this.createState();
      this.activateGroup(this.groups.group_1 ? 'group_1' : this.groupOrder[0]);
      this.playing = true;
      window.story_playing = true;
      $('.global_quest_page').hide();
      $('#back_main').hide();
      $('.story_page').show();
      $('#canvas').show();
      byId('full-progress').textContent = label;
      byId('full-log-body').replaceChildren();
      byId('full-log').hidden = true;
      byId('full-choices').hidden = true;
      byId('full-narration').hidden = true;
