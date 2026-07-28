      if (step.jingle !== undefined) await this.audio.play('jingle', step.jingle);
      await this.applyInlineAudio(step, generation);
    }

    async applyInlineAudio(step, generation) {
      const fields = [
        ...DIALOGUE_FIELDS.map(([key]) => key),
        'narration', 'progressNarration', 'progressFnarration',
      ];
      const regex = /\[(surround|se|jingle|bgm|flashEffect):([^\]]+)\]/giu;
      for (const field of fields) {
        const text = step[field];
        if (typeof text !== 'string') continue;
        for (const match of text.matchAll(regex)) {
          if (generation !== this.generation) return;
          const kind = match[1].toLowerCase();
          const cue = match[2].trim();
          if (!cue) continue;
          if (kind === 'flasheffect') this.flash(cue);
          else if (kind === 'bgm') {
            if (cue === 'stop') this.audio.stop('bgm');
            else await this.audio.play('bgm', cue, { loop: true });
          } else {
            await this.audio.play(kind === 'se' ? 'se' : kind, cue);
          }
        }
      }
    }

    async applyCharacters(patches, generation) {
      for (const patch of patches) {
        if (!patch || patch.id === undefined) continue;
        if (generation !== this.generation) return;
        const key = String(patch.id);
        const effect = String(patch.effect || '').toLowerCase();

        if (['hide', 'disappear', 'remove'].includes(effect)) {
          this.removeModel(key);
          continue;
        }

        const state = this.state.characters.get(key) || patch;
        const position = clamp(Math.trunc(finite(state.pos, 1)), 0, 2);
        let record = this.models.get(key);
        if (!record) record = await this.ensureModel(key, position, generation);
        if (!record || generation !== this.generation) continue;

        await this.moveModel(record, position);
        this.applyModelPatch(record, state);

        if (patch.voiceFullStop || patch.voiceStop) this.audio.stop('voice');
        const characterVoice = patch.voiceFull ?? patch.voiceFullAuto;
        if (characterVoice) {
          const result = await this.audio.play('voice', characterVoice, { kind: 'voiceFull' });
          this.currentVoiceDuration = Math.max(this.currentVoiceDuration, result.duration || 0);
        } else if (patch.voice) {
          const result = await this.audio.play('voice', patch.voice, { kind: 'voice' });
          this.currentVoiceDuration = Math.max(this.currentVoiceDuration, result.duration || 0);
        }

        if (effect.includes('fadein') || effect === 'appear') {
          record.sprite.alpha = 0;
          await this.animateAlpha(record.sprite, 0, 1, finite(patch.effectTime, 0.3) * 1000, generation);
        } else if (effect.includes('fadeout')) {
          await this.animateAlpha(
            record.sprite,
            finite(record.sprite.alpha, 1),
            0,
            finite(patch.effectTime, 0.3) * 1000,
            generation,
          );
          this.removeModel(key);
        } else if (patch.effect) {
          this.spawnEmotion(patch.effect, position);
        }
      }
    }

    async ensureModel(key, position, generation) {
      const failedAt = this.modelFailures.get(key);
      if (failedAt && performance.now() - failedAt < CONFIG.modelRetryMs) return null;

      const occupied = this.positions.get(position);
      if (occupied && occupied !== key) this.removeModel(occupied);

      const localBase = `./image/image_native/live2d_v4/${key}/`;
      const remoteBase = `${CONFIG.assetBase}/live2d_v4/${encodeURIComponent(key)}/`;
      let base = localBase;
      try {
        const response = await fetch(localBase + 'model.model3.json', {
          method: 'HEAD',
          cache: 'force-cache',
          credentials: 'omit',
        });
        if (!response.ok) base = remoteBase;
      } catch (_) {
        base = remoteBase;
      }

      try {
        const sprite = await window.show2(base, 'model.model3.json', POSITION_X[position]);
        if (generation !== this.generation) {
          try { sprite.destroy({ children: true }); } catch (_) {}
          return null;
        }
        const record = { key, position, sprite, base };
        this.models.set(key, record);
        this.positions.set(position, key);
        this.modelFailures.delete(key);
        return record;
      } catch (error) {
        this.modelFailures.set(key, performance.now());
        console.warn('[FULL STORY MODEL]', key, error);
        return null;
      }
    }

    async moveModel(record, position) {
      if (record.position !== position) {
        const occupied = this.positions.get(position);
        if (occupied && occupied !== record.key) this.removeModel(occupied);
        if (this.positions.get(record.position) === record.key) this.positions.delete(record.position);
        record.position = position;
        this.positions.set(position, record.key);
      }
      record.sprite.x = POSITION_X[position];
    }

    applyModelPatch(record, patch) {
      const sprite = record.sprite;
      try {
        if (patch.motion !== undefined) sprite.change_motion?.(patch.motion);
        if (patch.face) sprite.change_exp?.(patch.face);
        const core = sprite.internalModel?.coreModel;
        if (core) {
          if (patch.cheek !== undefined) core.setParameterValueById('ParamCheek', finite(patch.cheek));
          if (patch.mouthOpen !== undefined) core.setParameterValueById('ParamMouthOpenY', finite(patch.mouthOpen));
          if (patch.eyeClose !== undefined) {
            const value = 1 - clamp(finite(patch.eyeClose), 0, 1);
            core.setParameterValueById('ParamEyeLOpen', value);
            core.setParameterValueById('ParamEyeROpen', value);
          }
        }
        if (patch.posX !== undefined) sprite.x = finite(patch.posX, POSITION_X[record.position]);
        if (patch.posY !== undefined) sprite.y = finite(patch.posY);
        if (patch.scale !== undefined) {
          const scale = finite(patch.scale, 1);
          sprite.scale.set(scale, scale);
        }
        if (patch.angle !== undefined) sprite.rotation = finite(patch.angle) * Math.PI / 180;
        if (patch.zOrder !== undefined) {
          sprite.zIndex = finite(patch.zOrder);
          if (window.app?.stage) window.app.stage.sortableChildren = true;
        }
      } catch (error) {
        console.warn('[FULL STORY MODEL PATCH]', record.key, error);
      }
    }

    async animateAlpha(sprite, from, to, durationMs, generation) {
      if (durationMs <= 0) {
        sprite.alpha = to;
        return;
      }
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          if (generation !== this.generation) return resolve();
          const ratio = clamp((now - start) / durationMs, 0, 1);
          const eased = ratio * ratio * (3 - 2 * ratio);
          sprite.alpha = from + (to - from) * eased;
