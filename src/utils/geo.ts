import type { Coordenadas, Coordinates, Zona } from "../types";

export type GeoPoint = Coordenadas | Coordinates;

const EARTH_RADIUS_METERS = 6_371_000;

const POLYGON_EPSILON = 1e-12;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Normaliza cualquier formato de coordenadas soportado (dominio Coordenadas o expo Coordinates)
 * a latitud y longitud numéricas.
 */
export function extractLatLng(point: GeoPoint): { lat: number; lng: number } {
  if ("latitud" in point) {
    return { lat: point.latitud, lng: point.longitud };
  }
  return { lat: point.latitude, lng: point.longitude };
}

/**
 * Calcula la distancia en metros entre dos puntos geográficos utilizando la fórmula de Haversine.
 * Acepta tanto Coordenadas (latitud/longitud) como Coordinates (latitude/longitude).
 */
export function calculateDistanceInMeters(origin: GeoPoint, destination: GeoPoint): number {
  const p1 = extractLatLng(origin);
  const p2 = extractLatLng(destination);

  const dLat = toRadians(p2.lat - p1.lat);
  const dLng = toRadians(p2.lng - p1.lng);

  const lat1 = toRadians(p1.lat);
  const lat2 = toRadians(p2.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  // Math.min protege contra imprecisiones de punto flotante que superen 1
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Determina si dos coordenadas se encuentran dentro del radio especificado en metros.
 */
export function isWithinRadius(
  origin: GeoPoint,
  destination: GeoPoint,
  radiusMeters: number = 50
): boolean {
  return calculateDistanceInMeters(origin, destination) <= radiusMeters;
}

/**
 * Determina si el punto `point` yace sobre el segmento a–b, extremos incluidos.
 */
function isPointOnSegment(point: Coordenadas, a: Coordenadas, b: Coordenadas): boolean {
  const cross =
    (b.longitud - a.longitud) * (point.latitud - a.latitud) -
    (b.latitud - a.latitud) * (point.longitud - a.longitud);
  if (Math.abs(cross) > POLYGON_EPSILON) return false;
  return (
    point.latitud >= Math.min(a.latitud, b.latitud) - POLYGON_EPSILON &&
    point.latitud <= Math.max(a.latitud, b.latitud) + POLYGON_EPSILON &&
    point.longitud >= Math.min(a.longitud, b.longitud) - POLYGON_EPSILON &&
    point.longitud <= Math.max(a.longitud, b.longitud) + POLYGON_EPSILON
  );
}

/**
 * Determina si un punto cae dentro de un polígono mediante trazado de rayo (par-impar).
 * Un punto sobre una arista o sobre un vértice cuenta como incluido.
 * El polígono no repite el primer punto al final; con menos de tres vértices no contiene nada.
 */
export function isPointInPolygon(point: GeoPoint, polygon: readonly Coordenadas[]): boolean {
  if (polygon.length < 3) return false;

  const { lat, lng } = extractLatLng(point);
  const target: Coordenadas = { latitud: lat, longitud: lng };

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];

    if (isPointOnSegment(target, a, b)) return true;

    const crosses =
      a.latitud > target.latitud !== b.latitud > target.latitud &&
      target.longitud <
        ((b.longitud - a.longitud) * (target.latitud - a.latitud)) /
          (b.latitud - a.latitud) +
          a.longitud;

    if (crosses) inside = !inside;
  }

  return inside;
}

/**
 * Resuelve a qué zona pertenece un punto según su límite geográfico.
 * Devuelve el id de la primera zona que contiene al punto, o null si ninguna lo contiene.
 */
export function resolveZoneIdForCoordinates(
  point: GeoPoint,
  zones: readonly Zona[]
): string | null {
  for (const zone of zones) {
    if (isPointInPolygon(point, zone.limite)) {
      return zone.id;
    }
  }
  return null;
}
