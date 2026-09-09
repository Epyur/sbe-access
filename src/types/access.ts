/** Типы консоли доступов. Зеркало ответов auth-service (`/auth/access/*`,
 * см. sbe-core/auth-service/access_console.go). */

/** Пользователь системы — тот, кто хотя бы раз входил. */
export interface AccessUser {
  email: string;
  /** Последняя активность любого его устройства; null — ни разу не заходил после заведения. */
  last_seen_at: string | null;
  /** Сколько устройств привязано. */
  devices: number;
}

/** Приложение, которым вправе управлять текущий администратор. */
export interface AccessApp {
  app_id: string;
  name: string;
}

/** Роль человека в конкретном приложении. */
export interface AccessRole {
  app_id: string;
  name: string;
  /** Пусто — персональная роль не назначена; действует общий доступ приложения. */
  role: string;
  /** Общий доступ приложения: что получают те, кому роль не назначена. */
  common_access: string;
  /** Заполнено только у временной роли гостя — до какого момента она действует. */
  expires_at?: string;
}

/** Заявка «прошу доступ», поданная кнопкой из плагина. */
export interface AccessRequest {
  id: number;
  app_id: string;
  app_name: string;
  email: string;
  created_at: string;
}

/** Приглашение внешнему человеку: временная роль плюс ссылка входа в веб-портал. */
export interface AccessInvite {
  id: number;
  app_id: string;
  app_name: string;
  email: string;
  role: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  /** Готовая формулировка сервера: активно / ждём первого входа / истекло / отозвано. */
  state: string;
}

export interface AccessAppsResponse {
  apps: AccessApp[];
  email: string;
  global_admin: boolean;
}
