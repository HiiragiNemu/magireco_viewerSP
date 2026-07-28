        if (/^text(?:Red|Blue|Yellow|Black)$/i.test(command)) {
          tokens.push({ type: 'text', value });
        } else if (/^br$/i.test(command)) {
          tokens.push({ type: 'text', value: '\n' });
        } else {
          tokens.push({ type: 'command', command, value, raw: body });
        }
        cursor = regex.lastIndex;
      }
      if (cursor < input.length) tokens.push({ type: 'text', value: input.slice(cursor) });
      return tokens;
    }

    plainText(raw) {
      return this.tokenize(raw)
        .filter((token) => token.type === 'text')
        .map((token) => token.value)
        .join('')
        .replace(/@/g, '\n')
        .trim();
    }

    async renderRichText(node, raw, generation) {
      this.typing = true;
      this.fastForwardText = this.skip;
      this.currentTextNode = node;
      this.fullText = this.plainText(raw);
      node.textContent = '';

      try {
        for (const token of this.tokenize(raw)) {
          if (generation !== this.generation) return;
          if (token.type === 'command') {
            await this.executeInlineCommand(token, generation);
            continue;
          }

          const text = token.value.replace(/@/g, '\n');
          for (const character of [...text]) {
            if (generation !== this.generation) return;
            node.textContent += character;
            if (!this.fastForwardText && !this.skip) await delay(CONFIG.textSpeedMs);
          }
        }
      } finally {
        if (generation === this.generation) {
          node.textContent = this.fullText;
          this.typing = false;
          this.fastForwardText = false;
        }
      }
    }

    async executeInlineCommand(token, generation) {
      const command = token.command.toLowerCase();
      const value = token.value;

      if (command === 'wait') {
        if (!this.skip && !this.fastForwardText) {
          await delay(finite(value, 0) * 1000);
        }
        return;
      }

      if (command === 'chara') {
        const separator = value.indexOf(':');
        if (separator < 0) return;
        const characterId = value.slice(0, separator);
        const action = value.slice(separator + 1);
        this.applyInlineCharacter(characterId, action);
        return;
      }

      if (command === 'flasheffect') {
        this.flash(value);
        return;
      }

      if (['se', 'surround', 'jingle', 'bgm'].includes(command)) {
        if (generation !== this.generation) return;
        if (command === 'bgm') {
          if (value === 'stop') this.audio.stop('bgm');
          else await this.audio.play('bgm', value, { loop: true });
        } else {
          await this.audio.play(command === 'se' ? 'se' : command, value);
        }
      }
    }

    applyInlineCharacter(characterId, action) {
      const record = this.models.get(String(characterId));
      if (!record) return;
      const sprite = record.sprite;
      const core = sprite.internalModel?.coreModel;
      try {
        if (action.startsWith('face_')) {
          sprite.change_exp?.(action.slice(5));
        } else if (action.startsWith('motion_')) {
          sprite.change_motion?.(action.slice(7));
        } else if (action.startsWith('cheek_')) {
          core?.setParameterValueById('ParamCheek', finite(action.slice(6)));
        } else if (action.startsWith('eyeClose_')) {
          const value = 1 - clamp(finite(action.slice(9)), 0, 1);
          core?.setParameterValueById('ParamEyeLOpen', value);
          core?.setParameterValueById('ParamEyeROpen', value);
        } else if (action.startsWith('lipSynch_')) {
          if (finite(action.slice(9))) sprite.start_m?.();
          else sprite.stop_m?.();
        } else if (action.startsWith('mouthOpen_')) {
          core?.setParameterValueById('ParamMouthOpenY', finite(action.slice(10)));
        } else {
          this.spawnEmotion(action, record.position);
        }
      } catch (error) {
        console.warn('[FULL STORY INLINE CHARA]', characterId, action, error);
      }
    }

    showChoices(options) {
      const root = byId('full-choices');
      root.replaceChildren();
      this.waitingChoice = true;
      root.hidden = false;

      for (const option of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = this.plainText(option.textSelect || option.text || option.group || '选择');
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const target = option.group || option.target || option.next;
          if (!target || !Array.isArray(this.groups[target])) {
            status(`分支不存在：${target || '(empty)'}`, true);
            return;
          }
          this.waitingChoice = false;
          root.hidden = true;
          this.activateGroup(target);
          void this.next();
        });
        root.append(button);
      }
    }

    applyStageEffects(step) {
      if (step.flashEffect) this.flash(step.flashEffect);
      if (step.shake !== undefined) this.shake();
      if (step.effect) this.spawnStageEffect(step.effect);

      for (const patch of step.chara || []) {
        if (patch.effect && !/fade|hide|appear|disappear|remove/i.test(patch.effect)) {
          const state = this.state.characters.get(String(patch.id));
          this.spawnEmotion(patch.effect, state?.pos ?? 1);
        }
      }
    }

    flash(effect) {
      const node = byId('full-screen-fx');
      const white = String(effect || '').toLowerCase().includes('white');
      node.className = `${white ? 'white' : 'black'} active`;
      setTimeout(() => { node.className = ''; }, 480);
    }

    shake() {
      const page = document.querySelector('.story_page');
      page.classList.remove('full-shake');
      void page.offsetWidth;
      page.classList.add('full-shake');
    }

    spawnStageEffect(effect) {
      const value = String(effect || '').toLowerCase();
      if (value.includes('shake') || value.includes('vibrate')) this.shake();
      else if (value.includes('flash')) this.flash(effect);
    }

    spawnEmotion(effect, position) {
      const normalized = String(effect || '').toLowerCase();
      const symbol = normalized.includes('joy') ? '♥'
        : normalized.includes('question') ? '?'
          : normalized.includes('note') ? '♪'
            : normalized.includes('angry') ? '♯'
              : normalized.includes('sad') ? '●'
                : '✦';
      const node = document.createElement('div');
      node.className = 'full-emotion';
      node.textContent = symbol;
      node.style.left = `${POSITION_PERCENT[clamp(Math.trunc(finite(position, 1)), 0, 2)]}%`;
      node.style.color = normalized.includes('sad') ? '#78c9ff' : '#ff75ad';
      byId('full-story-overlay').append(node);
      setTimeout(() => node.remove(), 1200);
    }

    async applyTransition(effect, seconds, phase, generation) {
