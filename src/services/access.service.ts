import { requestUrl, RequestUrlParam } from 'obsidian';
import { getService } from '../../../sbe-core/src/bridge';
import { errorMessage } from '../../../sbe-core/src/utils/errors';
import type {
  AccessApp, AccessAppsResponse, AccessInvite, AccessRequest, AccessRole, AccessUser,
} from '../types/access';

/** Клиент консоли доступов. Ходит в auth-service с JWT приложения `access`
 * (выдаёт ЦУП, как любому плагину) — ключ устройства плагину недоступен,
 * поэтому серверные ручки консоли живут отдельной группой `/auth/access/*`
 * и проверяют именно этот токен (см. auth-service/access_console.go). */
export class AccessService {
  private getApiUrl: () => string;

  constructor(getApiUrl: () => string) {
    this.getApiUrl = getApiUrl;
  }

  get baseUrl(): string {
    return this.getApiUrl().trim().replace(/\/+$/, '');
  }

  private async getToken(): Promise<string> {
    const apstore = await getService('sbe-apstore');
    return apstore.auth.getToken('access');
  }

  /** Приложения, где текущий пользователь администратор, + его признак глобального админа. */
  async apps(): Promise<AccessAppsResponse> {
    const data = await this.get<AccessAppsResponse>('/auth/access/apps');
    return {
      apps: Array.isArray(data.apps) ? data.apps : [],
      email: data.email ?? '',
      global_admin: data.global_admin === true,
    };
  }

  /** Все, кто когда-либо входил в систему. */
  async users(): Promise<AccessUser[]> {
    const data = await this.get<{ users?: AccessUser[] }>('/auth/access/users');
    return Array.isArray(data.users) ? data.users : [];
  }

  /** Роли конкретного человека в приложениях, доступных администратору. */
  async userRoles(email: string): Promise<AccessRole[]> {
    const data = await this.get<{ roles?: AccessRole[] }>(
      `/auth/access/users/${encodeURIComponent(email)}`,
    );
    return Array.isArray(data.roles) ? data.roles : [];
  }

  /** Назначить или отозвать (role='') роль человека в приложении. */
  async setRole(appId: string, email: string, role: string): Promise<void> {
    await this.post('/auth/access/permissions', { app_id: appId, email, role });
  }

  /** Незакрытые заявки на доступ по приложениям администратора. */
  async requests(): Promise<AccessRequest[]> {
    const data = await this.get<{ requests?: AccessRequest[] }>('/auth/access/requests');
    return Array.isArray(data.requests) ? data.requests : [];
  }

  /** Решение по заявке: роль выдаётся сразу, `null` — отклонить. Заявителю уходит письмо. */
  async decideRequest(id: number, role: string | null): Promise<void> {
    await this.post(`/auth/access/requests/${id}`, role === null ? { decline: true } : { role });
  }

  /** Выданные приглашения внешним по приложениям администратора. */
  async invites(): Promise<AccessInvite[]> {
    const data = await this.get<{ invites?: AccessInvite[] }>('/auth/access/invites');
    return Array.isArray(data.invites) ? data.invites : [];
  }

  /** Выписать гостю временный доступ; ссылку входа сервер отправляет ему письмом. */
  async createInvite(appId: string, email: string, role: string, days: number): Promise<void> {
    await this.post('/auth/access/invites', { app_id: appId, email, role, days });
  }

  /** Досрочно погасить приглашение: роль снимается, сессии гостя обрываются. */
  async revokeInvite(id: number): Promise<void> {
    await this.post(`/auth/access/invites/${id}/revoke`, {});
  }

  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    const token = await this.getToken();
    const res = await this.request({
      url: `${this.baseUrl}${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    this.assertOk(res);
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.getToken();
    const res = await this.request({
      url: `${this.baseUrl}${path}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    this.assertOk(res);
    try {
      return JSON.parse(res.text) as T;
    } catch (e: unknown) {
      throw new Error(`Сервер вернул не JSON: ${errorMessage(e)}`);
    }
  }

  /** Единая обработка отказов: наверх уходит текст сервера, если он есть. */
  private assertOk(res: { status: number; text: string }): void {
    if (res.status >= 200 && res.status < 300) return;
    let msg = '';
    try {
      const data = JSON.parse(res.text) as { error?: string };
      msg = typeof data.error === 'string' ? data.error : '';
    } catch {
      msg = '';
    }
    if (res.status === 401) throw new Error('Нет доступа: войдите в ЦУП и получите ключ.');
    if (res.status === 403) throw new Error(msg || 'Недостаточно прав.');
    throw new Error(msg || `Сервер вернул HTTP ${res.status}`);
  }

  /** requestUrl в Obsidian не имеет таймаута — без обёртки зависший сервер не ответит никогда. */
  private async request(param: RequestUrlParam, timeoutMs = 30000): Promise<{ status: number; text: string }> {
    let timer: number | undefined;
    try {
      const response = await Promise.race([
        requestUrl({ ...param, throw: false }),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error(`Сервер не ответил за ${Math.round(timeoutMs / 1000)} сек`)),
            timeoutMs,
          );
        }),
      ]);
      return { status: response.status, text: response.text };
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }
}

/** Человекочитаемые названия ролей. Пустая строка — доступ не назначен лично. */
export const ROLE_LABELS: Record<string, string> = {
  '': 'нет персональной роли',
  viewer: 'Просмотр',
  commenter: 'Просмотр и комментарии',
  editor: 'Редактирование',
  admin: 'Администратор приложения',
  superadmin: 'Администратор системы',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Список доступных ролей: «администратора системы» выдаёт только глобальный админ. */
export function assignableRoles(globalAdmin: boolean): Array<{ value: string; label: string }> {
  const roles = [
    { value: '', label: 'Нет персональной роли' },
    { value: 'viewer', label: 'Просмотр' },
    { value: 'commenter', label: 'Просмотр и комментарии' },
    { value: 'editor', label: 'Редактирование' },
    { value: 'admin', label: 'Администратор приложения' },
  ];
  if (globalAdmin) roles.push({ value: 'superadmin', label: 'Администратор системы' });
  return roles;
}

/** Роли, доступные гостю: администратора внешнему человеку не выдают — это
 *  временный доступ к данным, а не к управлению правами (проверяет и сервер). */
export function guestRoles(): Array<{ value: string; label: string }> {
  return [
    { value: 'viewer', label: 'Просмотр' },
    { value: 'commenter', label: 'Просмотр и комментарии' },
    { value: 'editor', label: 'Редактирование' },
  ];
}

export type { AccessApp, AccessInvite, AccessRequest, AccessRole, AccessUser };
