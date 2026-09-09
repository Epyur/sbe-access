import { Plugin, WorkspaceLeaf } from 'obsidian';
import { AccessService } from './services/access.service';
import { AccessView, SBE_ACCESS_VIEW_TYPE } from './ui/access-view';
import { AccessSettingsTab } from './ui/settings-tab';
import { getService, publishService, unpublishService } from '../../sbe-core/src/bridge';
import type { SbeAccessApi } from '../../sbe-core/src/types';
import { errorMessage } from '../../sbe-core/src/utils/errors';

export interface SbeAccessSettings {
  apiUrl: string;
  lastAnnouncedVersion: string;
}

const DEFAULT_SETTINGS: SbeAccessSettings = {
  apiUrl: 'https://epyur.fvds.ru',
  lastAnnouncedVersion: '',
};

/** LogicTEAM.Доступы — консоль прав: список всех, кто входил в систему, и роли
 *  человека в тех приложениях, где текущий пользователь администратор.
 *  Своего бэкенда у плагина нет: права живут в auth-service (централизованы
 *  2026-09-09), плагин работает с ними по JWT приложения `access`. */
export default class SbeAccessPlugin extends Plugin {
  settings!: SbeAccessSettings;
  access!: AccessService;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.access = new AccessService(() => this.settings.apiUrl);

    this.registerView(
      SBE_ACCESS_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new AccessView(leaf, this),
    );

    this.addRibbonIcon('key-round', 'LogicTEAM.Доступы', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-access-console',
      name: 'Открыть консоль доступов',
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new AccessSettingsTab(this.app, this));

    // Без этого ЦУП не может открыть плагин: он зовёт getService(id).open()
    // по записи реестра (жалоба пользователя 2026-09-09 — консоль открывалась
    // только своей вьюхой, из ЦУП кнопка не работала).
    publishService<SbeAccessApi>('sbe-access', {
      open: async () => {
        await this.activateView();
      },
    }, {
      version: this.manifest.version,
      name: this.manifest.name,
    });

    void this.announceOnce();
  }

  onunload(): void {
    unpublishService('sbe-access');
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(SBE_ACCESS_VIEW_TYPE);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getLeaf(true);
    await leaf.setViewState({ type: SBE_ACCESS_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData() as Partial<SbeAccessSettings>) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Новость в канал «Новости» ЦУП — один раз на версию. */
  private async announceOnce(): Promise<void> {
    if (this.settings.lastAnnouncedVersion === this.manifest.version) return;
    try {
      const apstore = await getService('sbe-apstore');
      await apstore.announceUpdate({
        appId: this.manifest.id,
        appName: this.manifest.name,
        version: this.manifest.version,
        summary: 'Появилась общая настройка доступов. В одном месте виден список всех сотрудников, которые заходили в систему, и для каждого можно сразу выдать или снять доступ к тем приложениям, за которые вы отвечаете как администратор.',
      });
      this.settings.lastAnnouncedVersion = this.manifest.version;
      await this.saveSettings();
    } catch (e: unknown) {
      console.warn('Доступы: не удалось опубликовать новость об обновлении:', errorMessage(e));
    }
  }
}
