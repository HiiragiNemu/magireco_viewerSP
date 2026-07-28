          if (ratio >= 1) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }

    removeModel(key) {
      const record = this.models.get(String(key));
      if (!record) return;
      this.models.delete(String(key));
      if (this.positions.get(record.position) === String(key)) this.positions.delete(record.position);
      this.destroyModel(record);
    }

    destroyModel(record) {
      try {
        if (window.app?.stage?.children?.includes(record.sprite)) {
          window.app.stage.removeChild(record.sprite);
        }
        record.sprite.destroy({ children: true });
      } catch (_) {}
    }

    applyItems(stepItems) {
      for (const item of stepItems) {
        const key = String(item.id ?? item.path ?? `${item.posX || 0}:${item.posY || 0}`);
        const visible = String(item.visible ?? 'appear').toLowerCase();
        if (['disappear', 'hide', 'remove'].includes(visible)) {
          this.removeItem(key);
          continue;
        }
        this.state.items.set(key, { ...(this.state.items.get(key) || {}), ...item });
      }

      for (const [key, item] of this.state.items) this.renderItem(key, item);
    }

    renderItem(key, item) {
      let image = this.items.get(key);
      if (!image) {
        image = document.createElement('img');
        image.className = 'full-story-item';
        image.dataset.itemKey = key;
        byId('full-items').append(image);
        this.items.set(key, image);
      }

      const path = String(item.path || '').replace(/^\/+/, '');
      if (path) {
        const tail = path.split('/').map(encodeURIComponent).join('/');
        image.src = path.startsWith('http')
          ? path
          : `${CONFIG.assetBase}/scenario_img/${tail}`;
      }
      image.style.left = `${clamp(finite(item.posX, 960) / 1920 * 100, -100, 200)}%`;
      image.style.top = `${clamp(finite(item.posY, 540) / 1080 * 100, -100, 200)}%`;
      image.style.transform =
        `translate(-50%,-50%) scale(${finite(item.scale, 1)}) rotate(${finite(item.angle, 0)}deg)`;
      image.style.opacity = String(clamp(finite(item.opacity, 1), 0, 1));
      image.style.zIndex = String(finite(item.zOrder, 10));
    }

    removeItem(key) {
      this.state.items.delete(key);
      const image = this.items.get(key);
      if (image) image.remove();
      this.items.delete(key);
    }

    clearItems() {
      for (const image of this.items.values()) image.remove();
      this.items.clear();
      this.state.items.clear();
    }

    applyArmatures(step) {
      if (!Array.isArray(step.armatureList) && !Array.isArray(step.deleteArmatureList)) return;
      window.dispatchEvent(new CustomEvent('magireco:adv-armature', {
        detail: {
          add: step.armatureList || [],
          remove: step.deleteArmatureList || [],
          group: this.groupKey,
          index: this.index,
        },
      }));
    }

    selectDialogue(step) {
      if (step.textClear !== undefined || step.textAvClear !== undefined) return null;

      const narration = firstDefined(step, ['progressFnarration']);
      if (narration !== undefined) {
        return {
          kind: 'fnarration',
          position: 1,
          name: this.state.fnarrationName,
          raw: narration,
        };
      }

      const standardNarration = firstDefined(step, ['narration', 'progressNarration']);
      if (standardNarration !== undefined) {
        return {
          kind: 'narration',
          position: 1,
          name: this.state.narrationName,
          raw: standardNarration,
        };
      }

      for (const [field, position, kind] of DIALOGUE_FIELDS) {
        if (step[field] === undefined) continue;
        return {
          kind,
          position,
          name: kind === 'av'
            ? (this.state.avNames[position] || this.state.names[position])
            : this.state.names[position],
          raw: step[field],
        };
      }
      return undefined;
    }

    async applyDialogue(step, generation) {
      const dialogue = this.selectDialogue(step);
      if (dialogue === null) {
        this.state.dialogue = null;
        this.hideDialogue();
        return;
      }
      if (dialogue === undefined) return;

      this.state.dialogue = dialogue;
      if (dialogue.kind === 'narration' || dialogue.kind === 'fnarration') {
        this.hideDialogue();
        const overlay = byId('full-narration');
        overlay.hidden = false;
        byId('full-narration-name').textContent = dialogue.name || '';
        this.applyNarrationStyle(overlay, step, dialogue.kind === 'fnarration');
        await this.renderRichText(byId('full-narration-text'), String(dialogue.raw || ''), generation);
        this.appendLog(dialogue.name, this.plainText(dialogue.raw));
        return;
      }

      byId('full-narration').hidden = true;
      this.hideDialogue();
      const suffix = dialogue.position === 0 ? 'l' : dialogue.position === 2 ? 'r' : 'c';
      const nameNode = byId(`story_name_${suffix}`);
      const textNode = byId(`story_context_${suffix}`);
      const frame = byId(`story_log_ui_${suffix}`);
      nameNode.textContent = dialogue.name || '';
      nameNode.style.display = 'block';
      textNode.style.display = 'block';
      frame.style.display = 'block';

      const record = this.models.get(this.positions.get(dialogue.position));
      try { record?.sprite.start_m?.(); } catch (_) {}
      await this.renderRichText(textNode, String(dialogue.raw || ''), generation);
      try { record?.sprite.stop_m?.(); } catch (_) {}
      this.appendLog(dialogue.name, this.plainText(dialogue.raw));
    }

    applyNarrationStyle(node, step, floating) {
      const prefix = floating ? 'Fnarration' : 'narration';
      const opacity = finite(
        floating ? step.FnarrationCoverOpacity : step.narrationCoverOpacity,
        floating ? 0 : 0.42,
      );
      node.style.background = floating
        ? String(step.FnarrationCoverColor || `rgba(0,0,0,${opacity})`)
        : `rgba(0,0,0,${clamp(opacity, 0, 1)})`;
      const size = finite(
        floating ? step.FnarrationFontSize : step.narrationFontSize,
        0,
      );
      if (size > 0) node.style.fontSize = `${size}px`;
      const color = floating ? step.FnarrationTextColor : undefined;
      if (color) node.style.color = color;
      node.dataset.narrationKind = prefix;
    }

    tokenize(raw) {
      const input = String(raw || '');
      const tokens = [];
      const regex = /\[([^\]]+)\]/g;
      let cursor = 0;
      let match;
      while ((match = regex.exec(input))) {
        if (match.index > cursor) tokens.push({ type: 'text', value: input.slice(cursor, match.index) });
        const body = match[1];
        const separator = body.indexOf(':');
        const command = separator >= 0 ? body.slice(0, separator) : body;
        const value = separator >= 0 ? body.slice(separator + 1) : '';
