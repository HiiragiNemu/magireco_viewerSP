      void this.next();
    }

    activateGroup(groupKey) {
      if (!Array.isArray(this.groups[groupKey])) throw new Error(`剧情分支不存在：${groupKey}`);
      this.groupKey = groupKey;
      this.steps = this.groups[groupKey];
      this.index = -1;
      this.waitingChoice = false;
      byId('full-choices').hidden = true;
    }

    stop(backToQuest = false) {
      this.generation += 1;
      this.playing = false;
      window.story_playing = false;
      this.busy = false;
      this.waitingChoice = false;
      this.typing = false;
      this.fastForwardText = false;
      clearTimeout(this.timer);
      this.timer = 0;
      this.audio.stopAll();

      for (const record of this.models.values()) this.destroyModel(record);
      this.models.clear();
      this.positions.clear();
      this.clearItems();
      this.hideDialogue();
      byId('full-choices').hidden = true;
      byId('full-narration').hidden = true;
      byId('full-log').hidden = true;

      if (backToQuest && catalog.oldQuestPage) {
        catalog.oldQuestPage();
        installCatalogUi();
        void loadCatalogIndex().catch((error) => status(String(error), true));
      }
    }

    completeTyping() {
      if (!this.typing) return false;
      this.fastForwardText = true;
      return true;
    }

    async next() {
      if (!this.playing || this.waitingChoice) return false;
      if (this.completeTyping()) return true;
      if (this.busy) return false;
      clearTimeout(this.timer);
      this.timer = 0;

      if (this.index + 1 >= this.steps.length) {
        this.finish();
        return false;
      }

      this.busy = true;
      const generation = ++this.generation;
      const step = this.steps[++this.index] || {};
      this.currentVoiceDuration = 0;

      try {
        await this.applyTransition(step.turnChangeOut, step.turnChangeOutTime, 'out', generation);
        if (generation !== this.generation) return false;

        this.updateState(step);
        if (step.bg !== undefined) this.applyBackground(step.bg);
        await this.applyAudio(step, generation);
        if (generation !== this.generation) return false;

        await this.applyCharacters(step.chara || [], generation);
        if (generation !== this.generation) return false;

        this.applyItems(step.item || []);
        this.applyArmatures(step);
        await this.applyDialogue(step, generation);
        if (generation !== this.generation) return false;

        this.applyStageEffects(step);
        await this.applyTransition(step.turnChangeIn, step.turnChangeInTime, 'in', generation);
      } catch (error) {
        console.warn(`[FULL STORY ${this.groupKey}[${this.index}]]`, error);
        status(
          `步骤警告 ${this.groupKey}[${this.index + 1}]：${error instanceof Error ? error.message : error}`,
          true,
        );
      } finally {
        this.busy = false;
      }

      if (generation !== this.generation) return false;
      byId('full-progress').textContent =
        `${this.metadata?.entry?.id || ''} · ${this.groupKey} · ${this.index + 1}/${this.steps.length}`;

      if (Array.isArray(step.select) && step.select.length) {
        this.showChoices(step.select);
        return true;
      }

      this.schedule(step);
      return true;
    }

    finish() {
      clearTimeout(this.timer);
      this.timer = 0;
      this.playing = false;
      this.audio.stop('voice');
      byId('full-progress').textContent = 'END';
      status('本节剧情播放完成。');
    }

    updateState(step) {
      if (step.nameLeft !== undefined) this.state.names[0] = step.nameLeft;
      if (step.nameCenter !== undefined) this.state.names[1] = step.nameCenter;
      if (step.nameRight !== undefined) this.state.names[2] = step.nameRight;
      if (step.nameAvLeft !== undefined) this.state.avNames[0] = step.nameAvLeft;
      if (step.nameAvCenter !== undefined) this.state.avNames[1] = step.nameAvCenter;
      if (step.nameAvRight !== undefined) this.state.avNames[2] = step.nameAvRight;
      if (step.nameNarration !== undefined) this.state.narrationName = step.nameNarration;
      if (step.nameFnarration !== undefined) this.state.fnarrationName = step.nameFnarration;

      for (const patch of step.chara || []) {
        if (!patch || patch.id === undefined) continue;
        const key = String(patch.id);
        const previous = this.state.characters.get(key) || { id: patch.id, pos: 1 };
        this.state.characters.set(key, {
          ...previous,
          ...patch,
          pos: patch.pos !== undefined ? patch.pos : previous.pos,
        });
      }

      for (const item of step.item || []) {
        const key = String(item.id ?? item.path ?? `${item.posX || 0}:${item.posY || 0}`);
        const visible = String(item.visible ?? 'appear').toLowerCase();
        if (['disappear', 'hide', 'remove'].includes(visible)) this.state.items.delete(key);
        else this.state.items.set(key, { ...(this.state.items.get(key) || {}), ...item });
      }

      if (step.bgm !== undefined) this.state.bgm = step.bgm === 'stop' ? null : step.bgm;
      if (step.bg !== undefined) this.state.bg = step.bg;
    }

    applyBackground(value) {
      const image = byId('story_bg');
      if (value === 'black' || value === 'white') {
        image.removeAttribute('src');
        image.style.background = value;
        return;
      }
      image.style.background = '';
      const raw = String(value);
      const stem = raw.replace(/\.(png|jpe?g|webp)$/i, '');
      const candidates = [
        `./image/image_native/bg/story/${raw}`,
        `./image/image_native/bg/story/${stem}.jpg`,
        `${CONFIG.assetBase}/bg/story/${encodeURIComponent(stem)}.jpg`,
      ];
      let index = 0;
      const advance = () => {
        if (index >= candidates.length) {
          image.onerror = null;
          image.style.background = '#000';
          return;
        }
        image.src = candidates[index++];
      };
      image.onerror = advance;
      advance();
    }

    async applyAudio(step, generation) {
      if (step.voiceFullStop || step.voiceStop) this.audio.stop('voice');
      if (step.bgm !== undefined) {
        if (step.bgm === 'stop') this.audio.stop('bgm');
        else await this.audio.play('bgm', step.bgm, { loop: true });
      }
      const stepVoice = step.voiceFull ?? step.voiceFullAuto;
      if (stepVoice) {
        const result = await this.audio.play('voice', stepVoice, { kind: 'voiceFull' });
        this.currentVoiceDuration = Math.max(this.currentVoiceDuration, result.duration || 0);
      } else if (step.voice) {
        const result = await this.audio.play('voice', step.voice, { kind: 'voice' });
        this.currentVoiceDuration = Math.max(this.currentVoiceDuration, result.duration || 0);
      }
      if (step.se !== undefined) await this.audio.play('se', step.se);
      if (step.surround !== undefined) await this.audio.play('surround', step.surround);
