// The kit's reference page (packages/web/reference.html): every colour role, text style, icon and
// component of the system on one static page that reads the package's own stylesheets, with
// switches for theme, direction, platform, density and motion. Implemented components show their
// examples (kit/web/examples.html) in every state; each shows its spec: anatomy, keys, criteria,
// platform mapping. The browser suite checks this page with axe in every theme and direction.
import { readFileSync } from "node:fs";
import { ROOT } from "../dtcg.ts";
import type { Fonts } from "../fonts.ts";
import type { Icon } from "../icons.ts";
import { WCAG, readTextStyles, type Component } from "../kit.ts";
import type { Model } from "../model.ts";
import { cssName } from "./css.ts";

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The review server exposes only these verified, installed font files under /fonts/. */
export function emitReferenceFonts(fonts: Fonts): string {
  return fonts.families
    .flatMap((family) =>
      family.web.files.map(
        (file) => `@font-face {
  font-family: ${JSON.stringify(family.family)};
  font-style: normal;
  font-weight: ${String(file.weight)};
  font-display: swap;
  src: url("fonts/${file.file}") format("woff2");
  unicode-range: ${file.unicodeRange};
}`,
      ),
    )
    .join("\n");
}

/** The example markup of each component, from kit/web/examples.html. */
export function readExamples(): Map<string, string> {
  const html = readFileSync(`${ROOT}kit/web/examples.html`, "utf8");
  const out = new Map<string, string>();
  for (const m of html.matchAll(
    /<section data-component="([a-z-]+)">([\s\S]*?)<\/section>/g,
  ))
    out.set(m[1] ?? "", (m[2] ?? "").trim());
  return out;
}

const STYLE = `
  .ref { max-inline-size: 72rem; margin-inline: auto; padding: var(--space-6) min(var(--gutter), 5vi); }
  .ref-bar { position: sticky; inset-block-start: 0; z-index: var(--z-sticky); display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: end; padding: var(--space-4) var(--gutter); background: var(--surface-base); border-block-end: 1px solid var(--border-subtle); }
  .ref-bar .ref-setting { min-inline-size: 0; max-inline-size: 100%; display: grid; gap: var(--space-1); }
  .ref-bar label { color: var(--text-secondary); font-size: var(--text-size-caption); }
  .ref-bar select { min-inline-size: 0; max-inline-size: 100%; min-block-size: var(--size-target-min); padding-inline: var(--space-3); border: 1px solid var(--border-control); border-radius: var(--radius-md); background: var(--surface-raised); color: var(--text-primary); font: inherit; }
  .ref h2 { margin-block: var(--space-12) var(--space-4); }
  .ref-swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(12rem, 100%), 1fr)); gap: var(--space-3); padding: 0; list-style: none; }
  .ref-swatch { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); gap: var(--space-3); align-items: center; font-size: var(--text-size-caption); }
  .ref-swatch span:first-child { block-size: 2.5rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
  .ref-swatch code { color: var(--text-secondary); font-size: var(--text-size-caption); }
  .ref-component { min-inline-size: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); padding-block: var(--space-8); border-block-start: 1px solid var(--border-subtle); }
  .ref-example { min-inline-size: 0; padding: var(--space-6); border: 1px dashed var(--border-subtle); border-radius: var(--radius-lg); }
  .ref-spec { min-inline-size: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); color: var(--text-secondary); font-size: var(--text-size-label); }
  .ref-spec dt { color: var(--text-primary); }
  .ref-spec dd { margin: 0 0 var(--space-2); }
  /* Identifiers are useful reference content, including in a narrow or enlarged-text view. */
  .ref { overflow-wrap: anywhere; }
  @media (max-width: 30rem) {
    .ref-bar { position: static; }
    .ref-example { padding: min(var(--space-3), 2.5vi); }
  }
  .ref-icons { display: flex; flex-wrap: wrap; gap: var(--space-6); }
  .ref-icons figure { display: grid; justify-items: center; gap: var(--space-2); margin: 0; font-size: var(--text-size-caption); }
`;

const SCRIPT = `
  const root = document.documentElement;
  for (const select of document.querySelectorAll('[data-attr]')) {
    select.addEventListener('change', () => {
      const name = 'data-' + select.dataset.attr;
      if (select.value) root.setAttribute(name, select.value); else root.removeAttribute(name);
    });
  }
  for (const b of document.querySelectorAll('[data-open-dialog]'))
    b.addEventListener('click', () => document.getElementById(b.dataset.openDialog).showModal());
  for (const b of document.querySelectorAll('[data-close-dialog]'))
    b.addEventListener('click', () => b.closest('dialog').close());
  for (const b of document.querySelectorAll('[role=switch]'))
    b.addEventListener('click', () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')));
  for (const b of document.querySelectorAll('[aria-pressed]'))
    b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')));
  for (const b of document.querySelectorAll('[aria-expanded][aria-controls]:not([popovertarget])'))
    b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      document.getElementById(b.getAttribute('aria-controls')).hidden = !open;
    });
  // These reference controllers demonstrate the interaction contract. Products own state/actions.
  for (const input of document.querySelectorAll('[data-range-output]')) {
    const update = () => { document.getElementById(input.dataset.rangeOutput).value = input.value; };
    input.addEventListener('input', update);
    update();
  }
  for (const list of document.querySelectorAll('[role=tablist]')) {
    const tabs = [...list.querySelectorAll('[role=tab]')];
    const choose = (tab, focus) => {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
      }
      if (focus) tab.focus();
    };
    for (const tab of tabs) tab.addEventListener('click', () => choose(tab, false));
    list.addEventListener('keydown', event => {
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      const rtl = getComputedStyle(list).direction === 'rtl';
      const keys = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
      let next = index;
      if (event.key in keys) next = (index + keys[event.key] + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); choose(tabs[next], true);
    });
  }
  for (const button of document.querySelectorAll('[data-more]')) {
    button.addEventListener('click', () => {
      const list = document.getElementById(button.dataset.more);
      for (let i = 0; i < 2; i++) {
        const item = document.createElement('li');
        item.className = 'nd-list__row';
        item.textContent = 'Example item ' + (list.children.length + 1);
        list.append(item);
      }
      document.getElementById('ex-more-status').textContent = '2 examples added; ' + list.children.length + ' total.';
    });
  }
  // CSS anchor positioning keeps a menu at its trigger (kit.css); the script places it only where
  // the engine lacks it.
  const anchored = CSS.supports('anchor-name: --nd-menu');
  for (const trigger of document.querySelectorAll('[popovertarget]')) {
    const panel = document.getElementById(trigger.getAttribute('popovertarget'));
    const items = [...panel.querySelectorAll('.nd-menu__item')];
    if (anchored) {
      trigger.style.setProperty('anchor-name', '--nd-menu-' + panel.id);
      panel.style.setProperty('position-anchor', '--nd-menu-' + panel.id);
    }
    let typed = '', typedAt = 0;
    const focus = item => {
      for (const other of items) other.tabIndex = other === item ? 0 : -1;
      item.focus({ preventScroll: true });
      item.scrollIntoView({ block: 'nearest' });
    };
    const place = () => {
      if (anchored || !panel.matches(':popover-open')) return;
      const anchor = trigger.getBoundingClientRect(), box = panel.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(panel).paddingTop);
      const left = getComputedStyle(trigger).direction === 'rtl' ? anchor.right - box.width : anchor.left;
      panel.style.left = Math.max(gap, Math.min(left, innerWidth - box.width - gap)) + 'px';
      const below = anchor.bottom + gap;
      panel.style.top = Math.max(gap, below + box.height <= innerHeight - gap ? below : anchor.top - box.height - gap) + 'px';
    };
    const close = restore => { panel.hidePopover(); if (restore) trigger.focus(); };
    const open = (last = false) => {
      panel.showPopover();
      place();
      // Native toggle is queued. Focus belongs to this opening action, before another key.
      focus(last ? items.at(-1) : items.find(item => item.getAttribute('aria-selected') === 'true') || items[0]);
    };
    panel.addEventListener('beforetoggle', event => {
      trigger.setAttribute('aria-expanded', String(event.newState === 'open'));
    });
    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open')) {
        for (const item of items) item.tabIndex = -1;
        typed = '';
      }
    });
    trigger.addEventListener('click', event => {
      event.preventDefault();
      if (panel.matches(':popover-open')) close(false);
      else open();
    });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); open(event.key === 'ArrowUp');
      }
    });
    panel.addEventListener('click', event => {
      const item = event.target.closest('.nd-menu__item');
      if (!item || item.getAttribute('aria-disabled') === 'true') return;
      if (panel.getAttribute('role') === 'listbox') {
        for (const other of items) other.setAttribute('aria-selected', String(other === item));
      }
      document.getElementById('ex-menu-status').textContent = item.textContent.trim() + ' selected.';
      close(true);
    });
    panel.addEventListener('keydown', event => {
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      if (event.key === 'Tab') { close(true); return; }
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); items[index].click(); return;
      }
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = performance.now();
        typed = (now - typedAt > 700 ? '' : typed) + event.key.toLocaleLowerCase();
        typedAt = now;
        const prefix = [...typed].every(char => char === typed[0]) ? typed[0] : typed;
        for (let step = 1; step <= items.length; step++) {
          const candidate = (index + step) % items.length;
          if (items[candidate].textContent.trim().toLocaleLowerCase().startsWith(prefix)) { next = candidate; break; }
        }
      } else return;
      event.preventDefault(); if (next !== undefined) focus(items[next]);
    });
    window.addEventListener('resize', place);
    document.addEventListener('scroll', event => { if (!panel.contains(event.target)) place(); }, true);
  }

`;

function select(
  attr: string,
  label: string,
  options: string[],
  first: string,
): string {
  return `<div class="ref-setting"><label for="context-${attr}">${esc(label)}</label><select id="context-${attr}" data-attr="${attr}">${options
    .map(
      (o) =>
        `<option value="${esc(o)}"${o === first ? " selected" : ""}>${esc(o)}</option>`,
    )
    .join("")}</select></label>`;
}

function spec(c: Component): string {
  const list = (items: string[]): string =>
    `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  return `<dl class="ref-spec">
<dt>Pattern</dt><dd>${c.pattern.apg ? `APG ${esc(c.pattern.apg)} · ` : ""}<code>${esc(c.pattern.html)}</code></dd>
<dt>Anatomy</dt><dd>${list(c.anatomy.map((p) => `<strong>${esc(p.part)}</strong>${p.required ? "" : " (optional)"}: ${esc(p.description)}`))}</dd>
<dt>Variants</dt><dd>${c.variants.map((v) => esc(v.id)).join(", ")}${c.sizes.length ? ` · sizes ${c.sizes.map(esc).join(", ")}` : ""}</dd>
<dt>States</dt><dd>${c.states.map((s) => (c.cues[s] ? `${esc(s)} (${esc(c.cues[s])})` : esc(s))).join(", ")}</dd>
${c.keyboard.length ? `<dt>Keyboard</dt><dd>${list(c.keyboard.map((k) => `<kbd>${esc(k.keys)}</kbd>: ${esc(k.action)}`))}</dd>` : ""}
<dt>Accessibility</dt><dd>${esc(c.a11y.role)}${c.a11y.name ? ` · name: ${esc(c.a11y.name)}` : ""}${c.a11y.notes.length ? list(c.a11y.notes.map(esc)) : ""}</dd>
<dt>WCAG 2.2</dt><dd>${c.a11y.wcag.map((sc) => `${sc} ${esc(WCAG[sc]?.title ?? "")} (${WCAG[sc]?.level ?? ""})`).join("; ")}</dd>
<dt>Platforms</dt><dd>${list(Object.entries(c.platforms).map(([p, v]) => `${esc(p)}: <code>${esc(v)}</code>`))}</dd>
</dl>`;
}

export function emitReference(
  model: Model,
  components: Component[],
  icons: Icon[],
): string {
  const examples = readExamples();
  const at = model.get({});
  const colours = model.ids.filter(
    (id) =>
      at[id]?.$type === "color" &&
      ["theme", "foundation"].includes(model.owner.get(id) ?? ""),
  );
  const iconFigures = icons
    .map(
      (i) =>
        `<figure><svg class="nd-icon" viewBox="${i.viewBoxText}" fill="none" aria-hidden="true" focusable="false">${i.body}</svg><figcaption>${esc(i.name)}</figcaption></figure>`,
    )
    .join("");
  const styles = readTextStyles(model).styles;
  const body = components
    .map((c) => {
      const example = examples
        .get(c.id)
        ?.replace(
          '<div class="nd-cluster" data-icons></div>',
          `<div class="ref-icons">${iconFigures}</div>`,
        );
      return `<section class="ref-component" id="component-${c.id}" aria-labelledby="h-${c.id}">
<h3 id="h-${c.id}">${esc(c.name)} <span class="nd-badge">${c.status}</span></h3>
<p>${esc(c.summary)}</p>
${example ? `<div class="ref-example">${example}</div>` : ""}
${spec(c)}
</section>`;
    })
    .join("\n");
  return `<!doctype html>
<!-- GENERATED by nddev-design-system (\`just generate\`). Do not edit. -->
<html lang="en" data-theme="${model.defaults["theme"] ?? "dark"}" data-direction="${model.defaults["direction"] ?? "on"}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenNetwork design system reference</title>
<link rel="stylesheet" href="tokens.css" />
<link rel="stylesheet" href="reference-fonts.css" />
<link rel="stylesheet" href="text-styles.css" />
<link rel="stylesheet" href="kit.css" />
<style>${STYLE}</style>
</head>
<body>
<header class="ref-bar">
<a class="nd-skip-link" href="#main">Skip to content</a>
<strong>OpenNetwork design system</strong>
${select(
  "theme",
  "Theme",
  model.themes.map((t) => t.id),
  model.defaults["theme"] ?? "",
)}
${select("direction", "Direction", model.directions, model.defaults["direction"] ?? "")}
${select("platform", "Platform", model.registry.platforms?.css ?? ["web"], model.defaults["platform"] ?? "")}
${select("density", "Density", model.modifier("density").contexts, model.defaults["density"] ?? "")}
${select("motion", "Motion", model.modifier("motion").contexts, model.defaults["motion"] ?? "")}
</header>
<main class="ref" id="main">
<h1 class="nd-text-h1">Reference</h1>
<p class="nd-text-lead">Every role, text style, icon and component, drawn by the package's stylesheets in the chosen context.</p>
<h2 class="nd-text-h2">Colour roles</h2>
<ul class="ref-swatches">${colours
    .map(
      (id) =>
        `<li class="ref-swatch"><span style="background: var(${cssName(id)})"></span><span>${esc(id)}<br /><code>${cssName(id)}</code></span></li>`,
    )
    .join("")}</ul>
<h2 class="nd-text-h2">Text styles</h2>
<div class="nd-stack">${styles.map((s) => `<p class="nd-text-${s.id}">${esc(s.id)}: ${esc(s.description)}</p>`).join("")}</div>
<h2 class="nd-text-h2">Script coverage</h2>
<div class="nd-stack">
<p class="nd-text-body" lang="en" id="script-en">Design and engineering</p>
<p class="nd-text-body" lang="ru" id="script-ru">Дизайн и разработка</p>
<p class="nd-text-body" lang="kk" id="script-kk">Ә Ғ Қ Ң Ө Ұ Ү Һ І</p>
<p class="nd-text-body" lang="kk-Latn" id="script-kk-latn">Ä Ğ Q Ñ Ö Ū Ü Ş İ</p>
<p class="nd-text-body" lang="ar" dir="rtl" id="script-ar">التصميم والتطوير</p>
<p class="nd-text-body" lang="zh-Hans" id="script-zh">设计与开发</p>
</div>
<h2 class="nd-text-h2">Components</h2>
${body}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
