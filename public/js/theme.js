/* ── Theme Toggle — Light / Sepia / Dark ── */
(function () {
  const THEMES = ['light', 'sepia', 'dark'];
  const ICONS = { light: '\u2600', sepia: '\uD83D\uDCD6', dark: '\uD83C\uDF19' };
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    let idx = THEMES.indexOf(saved);
    btn.textContent = ICONS[saved] || ICONS.light;

    btn.addEventListener('click', () => {
      idx = (idx + 1) % THEMES.length;
      const next = THEMES[idx];
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      btn.textContent = ICONS[next];
    });
  });
})();
