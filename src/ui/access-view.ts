import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type SbeAccessPlugin from '../main';
import { assignableRoles, roleLabel } from '../services/access.service';
import type { AccessRole, AccessUser } from '../types/access';
import { errorMessage } from '../../../sbe-core/src/utils/errors';

export const SBE_ACCESS_VIEW_TYPE = 'sbe-access-view';

/** Фасад «LogicTEAM.Доступы»: слева список людей с поиском, справа карточка
 *  выбранного — его роли во всех приложениях, где текущий пользователь
 *  администратор. Экран от человека, а не от приложения: типовая задача —
 *  «пришёл сотрудник, выдать ему всё нужное разом». */
export class AccessView extends ItemView {
  private plugin: SbeAccessPlugin;
  private container!: HTMLElement;
  private state: {
    users: AccessUser[];
    search: string;
    selected: string | null;
    roles: AccessRole[];
    globalAdmin: boolean;
    appsCount: number;
    loading: boolean;
    error: string;
  };

  constructor(leaf: WorkspaceLeaf, plugin: SbeAccessPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.state = {
      users: [], search: '', selected: null, roles: [],
      globalAdmin: false, appsCount: 0, loading: true, error: '',
    };
  }

  getViewType(): string {
    return SBE_ACCESS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'LogicTEAM.Доступы';
  }

  getIcon(): string {
    return 'key-round';
  }

  async onOpen(): Promise<void> {
    this.container = this.contentEl;
    this.container.empty();
    this.container.addClass('tn-access-view');
    this.render();
    await this.loadAll();
  }

  async onClose(): Promise<void> {
    this.container.empty();
  }

  private async loadAll(): Promise<void> {
    this.state.loading = true;
    this.state.error = '';
    this.render();
    try {
      const apps = await this.plugin.access.apps();
      this.state.globalAdmin = apps.global_admin;
      this.state.appsCount = apps.apps.length;
      if (apps.apps.length === 0) {
        this.state.error = 'Вы не администратор ни одного приложения — настраивать нечего.';
        this.state.users = [];
        return;
      }
      this.state.users = await this.plugin.access.users();
    } catch (e: unknown) {
      this.state.error = errorMessage(e);
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  private async selectUser(email: string): Promise<void> {
    this.state.selected = email;
    this.state.roles = [];
    this.render();
    try {
      this.state.roles = await this.plugin.access.userRoles(email);
    } catch (e: unknown) {
      new Notice(`Доступы: ${errorMessage(e)}`);
    }
    this.render();
  }

  private render(): void {
    this.container.empty();

    const topbar = this.container.createDiv({ cls: 'tn-access-topbar' });
    topbar.createDiv({ cls: 'tn-access-title', text: 'LogicTEAM.Доступы' });
    const refresh = topbar.createEl('button', { cls: 'tn-btn tn-btn-ghost', text: '🔄 Обновить' });
    refresh.addEventListener('click', () => void this.loadAll());

    if (this.state.error) {
      this.container.createDiv({ cls: 'tn-access-error', text: this.state.error });
    }
    if (this.state.loading) {
      this.container.createDiv({ cls: 'tn-access-hint', text: 'Загрузка…' });
      return;
    }

    const body = this.container.createDiv({ cls: 'tn-access-body' });
    this.renderUsers(body);
    this.renderCard(body);
  }

  private renderUsers(body: HTMLElement): void {
    const side = body.createDiv({ cls: 'tn-access-side' });
    const searchInput = side.createEl('input', {
      cls: 'tn-doc-input',
      attr: { type: 'text', placeholder: 'Поиск по адресу…' },
    });
    searchInput.value = this.state.search;
    searchInput.addEventListener('input', () => {
      this.state.search = searchInput.value;
      this.renderUserList(list);
    });

    const list = side.createDiv({ cls: 'tn-access-users' });
    this.renderUserList(list);
  }

  private renderUserList(list: HTMLElement): void {
    list.empty();
    const q = this.state.search.trim().toLowerCase();
    const users = q ? this.state.users.filter(u => u.email.toLowerCase().includes(q)) : this.state.users;
    list.createDiv({ cls: 'tn-access-count', text: `Всего входивших: ${this.state.users.length}` });
    if (users.length === 0) {
      list.createDiv({ cls: 'tn-access-hint', text: 'Никого не нашлось.' });
      return;
    }
    for (const u of users) {
      const row = list.createEl('button', {
        cls: `tn-access-user${this.state.selected === u.email ? ' active' : ''}`,
      });
      row.createSpan({ cls: 'tn-access-user-email', text: u.email });
      row.createSpan({ cls: 'tn-access-user-seen', text: formatSeen(u.last_seen_at) });
      row.addEventListener('click', () => void this.selectUser(u.email));
    }
  }

  private renderCard(body: HTMLElement): void {
    const card = body.createDiv({ cls: 'tn-access-card' });
    if (!this.state.selected) {
      card.createDiv({
        cls: 'tn-access-hint',
        text: `Выберите человека слева. Настроить можно ${this.state.appsCount} приложени${plural(this.state.appsCount)} — те, где вы администратор.`,
      });
      return;
    }
    card.createEl('h2', { cls: 'tn-access-card-title', text: this.state.selected });
    if (this.state.roles.length === 0) {
      card.createDiv({ cls: 'tn-access-hint', text: 'Загрузка прав…' });
      return;
    }

    for (const r of this.state.roles) {
      const row = card.createDiv({ cls: 'tn-access-row' });
      row.createDiv({ cls: 'tn-access-app', text: r.name });

      const select = row.createEl('select', { cls: 'tn-doc-select' });
      for (const opt of assignableRoles(this.state.globalAdmin)) {
        select.createEl('option', { value: opt.value, text: opt.label });
      }
      select.value = r.role;
      select.addEventListener('change', () => void this.applyRole(r, select.value, select));

      // Что человек получает без персональной роли — иначе «нет роли» читается
      // как «нет доступа», хотя общий доступ приложения может открывать вход.
      const note = r.common_access
        ? `без личной роли: ${roleLabel(r.common_access).toLowerCase()}`
        : 'без личной роли доступа нет';
      row.createSpan({ cls: 'tn-access-note', text: note });
    }
  }

  private async applyRole(r: AccessRole, role: string, select: HTMLSelectElement): Promise<void> {
    const previous = r.role;
    select.disabled = true;
    try {
      await this.plugin.access.setRole(r.app_id, this.state.selected ?? '', role);
      r.role = role;
      new Notice(role
        ? `Доступы: ${r.name} — ${roleLabel(role).toLowerCase()}`
        : `Доступы: персональная роль в «${r.name}» снята`);
    } catch (e: unknown) {
      select.value = previous;
      new Notice(`Доступы: ${errorMessage(e)}`);
    } finally {
      select.disabled = false;
    }
  }
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'е';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'я';
  return 'й';
}

function formatSeen(iso: string | null): string {
  if (!iso) return 'ни разу не заходил';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} дн. назад`;
  return d.toLocaleDateString('ru-RU');
}
