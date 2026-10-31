import OsmMap, { type MapMarker } from "@/components/OsmMap";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { LoadingState } from "@/components/ui/state-views";
import {
  COLOR_POR_ESTADO,
  ETIQUETA_POR_ESTADO,
} from "@/constants/colores-estado";
import { toPublicReport } from "@/helpers/public-report";
import { reportService } from "@/services/reports";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";

const VecinoMapaScreen = () => {
  const [markers, setMarkers] = useState<MapMarker[] | null>(null);
  const [hayError, setHayError] = useState(false);

  useEffect(() => {
    let activo = true;

    reportService
      .getReports()
      .then((reportes) => {
        if (!activo) return;
        // M05: desde acá la pantalla solo trabaja con datos públicos
        const publicos = reportes.map(toPublicReport);
        setMarkers(
          publicos.map((r) => ({
            id: r.id,
            latitud: r.coordenadas.latitud,
            longitud: r.coordenadas.longitud,
            color: COLOR_POR_ESTADO[r.estado],
            titulo: r.codigo,
            detalle: `${r.direccion} - ${ETIQUETA_POR_ESTADO[r.estado]}`,
          })),
        );
      })
      .catch(() => {
        if (activo) setHayError(true);
      });

    return () => {
      activo = false;
    };
  }, []);

  if (hayError) {
    return (
      <ThemedView style={styles.centro}>
        <ThemedText type="default" themeColor="textSecondary">
          No se pudieron cargar los reportes.
        </ThemedText>
      </ThemedView>
    );
  }

  if (markers === null) {
    return <LoadingState message="Cargando mapa de reportes..." />;
  }

  return <OsmMap markers={markers} />;
};

const styles = StyleSheet.create({
  centro: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
});

export default VecinoMapaScreen;
