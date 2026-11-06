/* js/view/panels.js — App shell: three-step stepper, panel visibility and the busy indicator.
 * State: reads S.ui.step, S.ui.busy, S.source, S.parts, S.results
 * Gotchas: panels are built once (buildConnectPanel/buildEditPanel/buildExportPanel) and synced on every refresh();
 *          never rebuild an input that has focus.
 *
 * @auto-deps-begin
 * Defines: STEPS, buildShell, stepEnabled, syncShell
 * Uses: $, $$, S, goStep, h, setHidden
 * @auto-deps-end
 */
const STEPS = [
  { n: 1, title: 'Connect', hint: 'API and models' },
  { n: 2, title: 'Analyze and edit', hint: 'Find and adjust parts' },
  { n: 3, title: 'Export', hint: 'Download the SVG' }
];

function buildShell() {
  const nav = $('#stepper');
  nav.replaceChildren(...STEPS.map((step) => h('button', {
    type: 'button',
    class: 'step',
    'data-step': step.n,
    onclick: () => goStep(step.n)
  }, h('span', { class: 'step-title' }, step.title), h('span', { class: 'step-hint' }, step.hint))));
  document.body.append(h('div', { id: 'busy', class: 'busy', hidden: true, role: 'status' }));
}

function stepEnabled(n) {
  if (n === 3) return S.parts.length > 0 && Object.keys(S.results.partImages).length > 0;
  if (n === 2) return true;
  return true;
}

function syncShell() {
  $$('.step').forEach((btn) => {
    const n = Number(btn.dataset.step);
    btn.classList.toggle('active', S.ui.step === n);
    btn.disabled = !stepEnabled(n);
  });
  $$('.panel').forEach((panel) => setHidden(panel, Number(panel.dataset.step) !== S.ui.step));
  const busy = $('#busy');
  if (busy) {
    setHidden(busy, !S.ui.busy);
    busy.textContent = S.ui.busy ? S.ui.busy + '…' : '';
  }
  document.body.classList.toggle('is-busy', !!S.ui.busy);
}
