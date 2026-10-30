import { kvStorage } from './kv-client';
import type { CreateReportDTO, Reporte } from '@/types/index';
import type { PendingReport, SyncStatus } from '@/types/offline';
import { persistReportPhotos } from '@/utils/photo-storage';

/**
 * Prefijo de las claves de reportes locales. Cada reporte ocupa su propia clave,
 * de modo que actualizar uno nunca reescribe la colección completa.
 */
const PENDING_REPORT_KEY_PREFIX = '@reporte_ciudadano:pending_report:';

/** Formato de id que acepta la API para registros generados por el cliente. */
const REPORT_ID_PATTERN = /^rep-[A-Za-z0-9_-]{3,36}$/;

function pendingReportKey(localId: string): string {
  return `${PENDING_REPORT_KEY_PREFIX}${localId}`;
}

/**
 * Genera un id compatible con la API (`rep-<timestampBase36><aleatorio>`).
 * El timestamp en base 36 aporta unicidad temporal y el sufijo aleatorio evita
 * colisiones entre dispositivos; ambos son alfanuméricos, así que el resultado
 * cumple `/^rep-[A-Za-z0-9_-]{3,36}$/` por construcción.
 */
export function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);

  return `rep-${timestamp}${random}`;
}

/**
 * Indica si un id tiene el formato que exige la API.
 */
export function isValidReportId(id: string): boolean {
  return REPORT_ID_PATTERN.test(id);
}

/**
 * Deriva el código provisional determinista a partir del identificador local.
 */
function generateProvisionalCode(localId: string): string {
  const suffix = localId.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(-12);
  return `RC-PEND-${suffix}`;
}

/**
 * Obtiene la lista completa de reportes guardados localmente, del más reciente al más antiguo.
 */
export async function getAllLocalReports(): Promise<PendingReport[]> {
  const keys = await kvStorage.getKeysByPrefix(PENDING_REPORT_KEY_PREFIX);

  if (keys.length === 0) {
    return [];
  }

  const stored = await Promise.all(
    keys.map((key) => kvStorage.getItem<PendingReport>(key)),
  );

  return stored
    .filter((item): item is PendingReport => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Obtiene únicamente los reportes pendientes de sincronización (no sincronizados).
 */
export async function getPendingReports(): Promise<PendingReport[]> {
  const all = await getAllLocalReports();
  return all.filter((item) => item.syncStatus !== 'sincronizado' && !item.reporte.sincronizado);
}

/**
 * Obtiene un reporte local por su ID local o clientRequestId.
 * Busca primero la clave individual y solo recorre el resto si no hay coincidencia directa.
 */
export async function getLocalReportById(id: string): Promise<PendingReport | null> {
  const direct = await kvStorage.getItem<PendingReport>(pendingReportKey(id));

  if (direct) {
    return direct;
  }

  const all = await getAllLocalReports();
  return all.find((item) => item.clientRequestId === id) ?? null;
}

/**
 * Guarda un nuevo reporte marcado como sincronizado: false en su propia clave.
 * Reutiliza el id y la fecha de creación del cliente cuando ya vienen en el payload,
 * para que un reintento con el mismo id no genere un registro distinto.
 */
export async function savePendingReport(
  payload: CreateReportDTO,
  options?: { uncertainResponse?: boolean }
): Promise<PendingReport> {
  const localId = payload.id ?? generateReportId();
  const creadoEn = payload.creadoEn ?? new Date().toISOString();
  const clientRequestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const fotosPersistidas = payload.fotos?.length
    ? await persistReportPhotos(payload.fotos)
    : [];

  const reporteLocal: Reporte = {
    id: localId,
    codigo: generateProvisionalCode(localId),
    tipoId: payload.tipoId,
    descripcion: payload.descripcion,
    audioUrl: payload.audioUrl,
    fotos: fotosPersistidas,
    coordenadas: payload.coordenadas,
    direccion: payload.direccion,
    zonaId: payload.zonaId,
    estado: 'recibido',
    autorId: payload.autorId,
    cuadrillaId: payload.cuadrillaId,
    duplicadoDe: null,
    adhesiones: 0,
    creadoEn,
    sincronizado: false,
  };

  const pendingItem: PendingReport = {
    localId,
    clientRequestId,
    reporte: reporteLocal,
    payload: {
      ...payload,
      id: localId,
      creadoEn,
      fotos: fotosPersistidas,
    },
    syncStatus: 'pendiente',
    uncertainResponse: options?.uncertainResponse ?? false,
    retryCount: 0,
    createdAt: creadoEn,
  };

  await kvStorage.setItem(pendingReportKey(localId), pendingItem);

  return pendingItem;
}

export interface UpdateSyncStatusOptions {
  uncertainResponse?: boolean;
}

/**
 * Normaliza a 'pendiente' con respuesta incierta cualquier reporte que haya quedado
 * en estado 'sincronizando' a causa de un cierre o interrupción previa de la aplicación.
 * Reescribe únicamente las claves de los reportes afectados.
 */
export async function normalizeInterruptedReports(): Promise<number> {
  const all = await getAllLocalReports();
  const interrupted = all.filter((item) => item.syncStatus === 'sincronizando');

  await Promise.all(
    interrupted.map((item) => {
      const normalized: PendingReport = {
        ...item,
        syncStatus: 'pendiente',
        uncertainResponse: true,
      };

      return kvStorage.setItem(pendingReportKey(item.localId), normalized);
    }),
  );

  return interrupted.length;
}

/**
 * Actualiza el estado de sincronización y registra errores o reintentos.
 * Lee y reescribe únicamente la clave del reporte indicado.
 */
export async function updateSyncStatus(
  localId: string,
  status: SyncStatus,
  errorMessage?: string,
  options?: UpdateSyncStatusOptions
): Promise<PendingReport | null> {
  const key = pendingReportKey(localId);
  const current = await kvStorage.getItem<PendingReport>(key);

  if (!current) {
    return null;
  }

  const updated: PendingReport = {
    ...current,
    syncStatus: status,
    lastAttemptAt: new Date().toISOString(),
    retryCount: status === 'sincronizando' ? current.retryCount + 1 : current.retryCount,
    errorMessage: errorMessage ?? current.errorMessage,
    uncertainResponse:
      options?.uncertainResponse !== undefined
        ? options.uncertainResponse
        : current.uncertainResponse,
  };

  await kvStorage.setItem(key, updated);
  return updated;
}

/**
 * Marca un reporte local como sincronizado exitosamente, conservando el registro
 * y asociando el identificador y el número de seguimiento definitivo del servidor.
 */
export async function markReportAsSynced(
  localId: string,
  serverReportId: string,
  codigo: string
): Promise<PendingReport | null> {
  const key = pendingReportKey(localId);
  const current = await kvStorage.getItem<PendingReport>(key);

  if (!current) {
    return null;
  }

  const updated: PendingReport = {
    ...current,
    syncStatus: 'sincronizado',
    uncertainResponse: false,
    serverReportId,
    reporte: {
      ...current.reporte,
      id: serverReportId,
      codigo,
      sincronizado: true,
    },
    errorMessage: undefined,
  };

  await kvStorage.setItem(key, updated);
  return updated;
}

/**
 * Elimina un reporte del almacenamiento local.
 * Devuelve false si la clave no existía.
 */
export async function removeLocalReport(localId: string): Promise<boolean> {
  const key = pendingReportKey(localId);
  const current = await kvStorage.getItem<PendingReport>(key);

  if (!current) {
    return false;
  }

  await kvStorage.removeItem(key);
  return true;
}

/**
 * Limpia todos los reportes almacenados localmente, sin tocar otras claves.
 */
export async function clearAllLocalReports(): Promise<void> {
  const keys = await kvStorage.getKeysByPrefix(PENDING_REPORT_KEY_PREFIX);
  await Promise.all(keys.map((key) => kvStorage.removeItem(key)));
}
