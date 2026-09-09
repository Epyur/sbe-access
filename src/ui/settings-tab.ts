import { App, PluginSettingTab, Setting } from 'obsidian';
import type SbeAccessPlugin from '../main';

export class AccessSettingsTab extends PluginSettingTab {
  private plugin: SbeAccessPlugin;

  constructor(app: App, plugin: SbeAccessPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setHeading()
      .setName('LogicTEAM.Доступы');

    containerEl.createDiv({
      cls: 'tn-access-hint',
      text: 'Консоль показывает всех, кто хотя бы раз входил в систему, и позволяет выдавать роли '
        + 'в тех приложениях, где вы администратор. Тонкие права внутри приложения (папки и подборки '
        + 'Фотобанка, группы и проекты ЛИМС) настраиваются там же, где и раньше — в самих плагинах.',
    });

    new Setting(containerEl)
      .setName('Адрес сервера')
      .setDesc('Обычно менять не нужно: тот же сервер, что у остальных плагинов SBE.')
      .addText(text => text
        .setPlaceholder('https://epyur.fvds.ru')
        .setValue(this.plugin.settings.apiUrl)
        .onChange(async (value) => {
          this.plugin.settings.apiUrl = value.trim();
          await this.plugin.saveSettings();
        }));
  }
}
