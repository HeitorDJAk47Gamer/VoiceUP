(() => {
  'use strict';

  const settingsModal = document.querySelector('#settings-modal');
  const settingsDialog = settingsModal?.querySelector(':scope > section');
  const settingsTabs = document.querySelector('#settings-tabs');
  const settingsPanels = document.querySelector('#settings-tab-panels');
  const settingsButton = document.querySelector('#settings-button');
  const lastSettingsTabKey = 'voiceup-settings-tab-v1';

  const settingsTabButtons = () => [...(settingsTabs?.querySelectorAll('[data-settings-tab]') || [])];
  const settingsTabPanels = () => [...(settingsPanels?.querySelectorAll('[data-settings-panel]') || [])];

  const syncSettingsNavigation = (activeName, { focus = false } = {}) => {
    if (!settingsTabs || !settingsPanels) return;
    const buttons = settingsTabButtons();
    const available = new Set(buttons.map((button) => button.dataset.settingsTab));
    const name = available.has(activeName) ? activeName : (buttons[0]?.dataset.settingsTab || 'general');

    buttons.forEach((button) => {
      const selected = button.dataset.settingsTab === name;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    settingsTabPanels().forEach((panel) => {
      const selected = panel.dataset.settingsPanel === name;
      panel.classList.toggle('active', selected);
      panel.setAttribute('aria-hidden', String(!selected));
    });
    try { localStorage.setItem(lastSettingsTabKey, name); } catch { /* optional preference */ }
  };

  if (settingsDialog && settingsTabs && settingsPanels) {
    settingsDialog.classList.add('settings-side-layout');
    settingsTabs.setAttribute('aria-orientation', 'vertical');

    settingsTabButtons().forEach((button) => {
      const name = button.dataset.settingsTab;
      const panel = settingsPanels.querySelector(`[data-settings-panel="${name}"]`);
      button.id ||= `settings-tab-${name}`;
      button.setAttribute('role', 'tab');
      if (panel) {
        panel.id ||= `settings-panel-${name}`;
        button.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', button.id);
      }
    });

    settingsTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-settings-tab]');
      if (!button) return;
      requestAnimationFrame(() => syncSettingsNavigation(button.dataset.settingsTab));
    });

    settingsTabs.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = settingsTabButtons();
      const current = Math.max(0, buttons.indexOf(document.activeElement));
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault();
      buttons[nextIndex]?.click();
      syncSettingsNavigation(buttons[nextIndex]?.dataset.settingsTab, { focus: true });
    });

    settingsButton?.addEventListener('click', () => {
      let remembered = 'general';
      try { remembered = localStorage.getItem(lastSettingsTabKey) || remembered; } catch { /* optional preference */ }
      requestAnimationFrame(() => {
        const target = settingsTabs.querySelector(`[data-settings-tab="${remembered}"]`) || settingsTabButtons()[0];
        target?.click();
        syncSettingsNavigation(target?.dataset.settingsTab);
        settingsPanels.querySelector('.settings-panel.active')?.scrollTo?.({ top: 0 });
      });
    });

    const initial = settingsTabs.querySelector('.settings-tab.active')?.dataset.settingsTab || 'general';
    syncSettingsNavigation(initial);
  }

  const densitySelect = document.querySelector('#appearance-density');
  const densityLabel = densitySelect?.closest('label');
  const densityCopy = {
    'pt-BR': {
      comfortable: ['Confortável', 'Mais respiro e controles maiores'],
      compact: ['Compacto', 'Mais conteúdo visível na tela']
    },
    'en-US': {
      comfortable: ['Comfortable', 'More spacing and larger controls'],
      compact: ['Compact', 'More content visible on screen']
    },
    'es-ES': {
      comfortable: ['Cómodo', 'Más espacio y controles grandes'],
      compact: ['Compacto', 'Más contenido visible en pantalla']
    },
    'fr-FR': {
      comfortable: ['Confortable', 'Plus d’espace et de grands contrôles'],
      compact: ['Compact', 'Plus de contenu visible à l’écran']
    }
  };

  if (densitySelect && densityLabel && !document.querySelector('#density-mode-picker')) {
    densityLabel.classList.add('density-setting');
    densitySelect.classList.add('density-native-select');
    densitySelect.insertAdjacentHTML('afterend', `<div id="density-mode-picker" class="density-mode-picker" role="radiogroup" aria-label="Densidade da interface">
      <button type="button" data-density-choice="comfortable" role="radio">
        <span class="density-preview density-preview-comfortable" aria-hidden="true"><i></i><i></i><i></i></span>
        <span><strong></strong><small></small></span>
      </button>
      <button type="button" data-density-choice="compact" role="radio">
        <span class="density-preview density-preview-compact" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span><strong></strong><small></small></span>
      </button>
    </div>`);

    const picker = document.querySelector('#density-mode-picker');
    const syncDensityPicker = () => {
      const locale = densityCopy[document.documentElement.lang] ? document.documentElement.lang : 'pt-BR';
      picker.querySelectorAll('[data-density-choice]').forEach((button) => {
        const value = button.dataset.densityChoice;
        const selected = densitySelect.value === value;
        const [title, detail] = densityCopy[locale][value];
        button.querySelector('strong').textContent = title;
        button.querySelector('small').textContent = detail;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-checked', String(selected));
      });
    };

    picker.addEventListener('click', (event) => {
      const button = event.target.closest('[data-density-choice]');
      if (!button || densitySelect.value === button.dataset.densityChoice) return;
      densitySelect.value = button.dataset.densityChoice;
      densitySelect.dispatchEvent(new Event('input', { bubbles: true }));
      densitySelect.dispatchEvent(new Event('change', { bubbles: true }));
      syncDensityPicker();
    });
    densitySelect.addEventListener('input', syncDensityPicker);
    densitySelect.addEventListener('change', syncDensityPicker);
    window.addEventListener('voiceup:languagechange', syncDensityPicker);
    syncDensityPicker();
  }

  const profileFooter = document.querySelector('.self-card');
  const profileControls = profileFooter?.querySelector('.self-media-state');
  if (profileFooter) profileFooter.classList.add('profile-footer-card');
  if (profileControls) {
    profileControls.classList.add('profile-footer-controls');
    const footerCopy = {
      'pt-BR': ['Ações rápidas', 'Controles rápidos do perfil'],
      'en-US': ['Quick actions', 'Quick profile controls'],
      'es-ES': ['Acciones rápidas', 'Controles rápidos del perfil'],
      'fr-FR': ['Actions rapides', 'Contrôles rapides du profil']
    };
    const syncFooterCopy = () => {
      const locale = footerCopy[document.documentElement.lang] ? document.documentElement.lang : 'pt-BR';
      const [label, ariaLabel] = footerCopy[locale];
      profileControls.dataset.quickActionsLabel = label;
      profileControls.setAttribute('aria-label', ariaLabel);
    };
    window.addEventListener('voiceup:languagechange', syncFooterCopy);
    syncFooterCopy();
  }
})();
