import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const result = {
  ok: false,
  checkpoints: [],
  voiceRequests: [],
  pageErrors: [],
  consoleErrors: [],
  failure: null,
};

const checkpoint = (name, detail = null) => {
  result.checkpoints.push({ name, detail, at: new Date().toISOString() });
  console.log(`[checkpoint] ${name}`, detail ?? '');
};

let browser;
let page;
try {
  const sample = await readFile('test-fixtures/sample.hca');
  browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', error => result.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });
  await page.route('https://pub-70a248f1a6fe4ca597e7a10f8b95dfd8.r2.dev/fullvoice/**', async route => {
    result.voiceRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: sample });
  });

  await page.goto('http://127.0.0.1:4173/index.html', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  checkpoint('page-loaded', await page.title());

  await page.waitForFunction(
    () => Boolean(window.MagirecoFullStory?.player?.__storyRuntimeV3Installed),
    null,
    { timeout: 120000 },
  );
  checkpoint('runtime-installed');

  const controlState = await page.evaluate(() => ({
    log: Boolean(document.getElementById('story_log')),
    auto: Boolean(document.getElementById('story_auto')),
    skip: Boolean(document.getElementById('story_skip')),
    backlog: Boolean(document.getElementById('full-log')),
    hca: Boolean(window.MagirecoHcaPlayer),
  }));
  checkpoint('controls-present', controlState);
  if (!Object.values(controlState).every(Boolean)) {
    throw new Error(`Required runtime controls are missing: ${JSON.stringify(controlState)}`);
  }

  await page.evaluate(() => {
    const player = window.MagirecoFullStory.player;
    player.load({
      story: {
        group_1: [
          {
            nameCenter: '语音验证',
            textCenter: '第一句真实 HCA 语音验证。',
            voiceFull: 'section_101102/vo_full_101102-7-1',
            autoTurnLast: 0.1,
          },
          {
            nameCenter: '系统',
            textCenter: 'AUTO 已推进到第二句。',
          },
        ],
      },
    }, 'runtime-v3-e2e');
  });
  checkpoint('synthetic-story-loaded');

  await page.waitForFunction(() => document.querySelector('.story_page')?.style.display !== 'none');
  await page.waitForFunction(() => window.MagirecoFullStory.player.index >= 0);
  checkpoint('first-step-applied', await page.evaluate(() => ({
    index: window.MagirecoFullStory.player.index,
    text: document.getElementById('story_context_c')?.textContent,
  })));

  await page.click('#story_auto');
  await page.waitForFunction(
    () => window.MagirecoFullStory.player.auto === true || window.MagirecoFullStory.player.autoEnabled === true,
  );
  checkpoint('auto-enabled');

  await page.waitForFunction(() => window.MagirecoHcaPlayer?.isPlaying?.('voice') === true, null, {
    timeout: 120000,
  });
  if (!result.voiceRequests.length) throw new Error('No HCA voice request was observed');
  checkpoint('voice-playing', result.voiceRequests[0]);

  await page.click('#story_log');
  const logOpen = await page.locator('#full-log').evaluate(node => !node.hidden);
  const logText = await page.locator('#full-log-body').innerText();
  if (!logOpen) throw new Error('LOG did not open');
  if (!logText.includes('第一句真实 HCA 语音验证')) {
    throw new Error(`LOG missing dialogue: ${logText}`);
  }
  checkpoint('log-opened', logText);

  await page.click('#full-log-close');
  if (!(await page.locator('#full-log').evaluate(node => node.hidden))) {
    throw new Error('LOG did not close');
  }
  checkpoint('log-closed');

  await page.click('#story_skip');
  if (!(await page.locator('#story_skip').evaluate(node => node.classList.contains('full-active')))) {
    throw new Error('SKIP did not activate');
  }
  checkpoint('skip-enabled');
  await page.click('#story_skip');
  checkpoint('skip-disabled');

  await page.waitForFunction(() => window.MagirecoFullStory.player.index >= 1, null, {
    timeout: 120000,
  });
  const autoVisual = await page.locator('#story_auto').evaluate(node => node.classList.contains('full-active'));
  if (!autoVisual) throw new Error('AUTO visual state was lost');
  checkpoint('auto-advanced', await page.evaluate(() => window.MagirecoFullStory.player.index));

  result.ok = true;
} catch (error) {
  result.failure = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error(result.failure);
  process.exitCode = 1;
} finally {
  if (page) {
    try {
      result.dom = await page.evaluate(() => ({
        readyState: document.readyState,
        player: window.MagirecoFullStory ? {
          installed: Boolean(window.MagirecoFullStory.player?.__storyRuntimeV3Installed),
          index: window.MagirecoFullStory.player?.index,
          playing: window.MagirecoFullStory.player?.playing,
          auto: window.MagirecoFullStory.player?.auto,
          autoEnabled: window.MagirecoFullStory.player?.autoEnabled,
          skip: window.MagirecoFullStory.player?.skip,
        } : null,
        hca: window.MagirecoHcaPlayer ? {
          state: window.MagirecoHcaPlayer.state,
          voicePlaying: window.MagirecoHcaPlayer.isPlaying?.('voice') ?? false,
        } : null,
        controls: ['story_log', 'story_auto', 'story_skip', 'full-log', 'full-log-body']
          .reduce((output, id) => {
            const node = document.getElementById(id);
            output[id] = node ? {
              hidden: node.hidden,
              display: getComputedStyle(node).display,
              classes: node.className,
              ariaPressed: node.getAttribute('aria-pressed'),
            } : null;
            return output;
          }, {}),
      }));
    } catch (error) {
      result.domCaptureFailure = String(error);
    }
    try {
      await page.screenshot({ path: 'story-runtime-v3.png', fullPage: true });
    } catch (error) {
      result.screenshotFailure = String(error);
    }
  }
  await writeFile('story-runtime-v3-result.json', JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  console.log(JSON.stringify(result, null, 2));
}
