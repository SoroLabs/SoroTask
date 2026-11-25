export type SupportedLocale = 'en' | 'es' | 'zh' | 'fr';

export interface Translations {
  appName: string;
  tasks: string;
  createTask: string;
  network: string;
  status: string;
  balance: string;
}

export const DICTIONARIES: Record<SupportedLocale, Translations> = {
  en: {
    appName: "SoroTask Keeper Hub",
    tasks: "Scheduled Tasks",
    createTask: "Create New Task",
    network: "Network",
    status: "Status",
    balance: "Balance",
  },
  es: {
    appName: "Centro de Automatización SoroTask",
    tasks: "Tareas Programadas",
    createTask: "Crear Nueva Tarea",
    network: "Red",
    status: "Estado",
    balance: "Saldo",
  },
  zh: {
    appName: "SoroTask 自动化中枢",
    tasks: "计划任务",
    createTask: "创建新任务",
    network: "网络",
    status: "状态",
    balance: "余额",
  },
  fr: {
    appName: "Centre de Tâches SoroTask",
    tasks: "Tâches Planifiées",
    createTask: "Créer une Tâche",
    network: "Réseau",
    status: "Statut",
    balance: "Solde",
  },
};

export function formatStellarBalance(stroops: number | bigint, locale: SupportedLocale = 'en'): string {
  const xlm = Number(stroops) / 10_000_000;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  }).format(xlm) + " XLM";
}
