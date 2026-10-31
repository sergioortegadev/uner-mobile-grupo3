import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

export interface MapMarker {
  id: string;
  latitud: number;
  longitud: number;
  color: string;
  titulo: string;
  detalle?: string;
}

interface OsmMapProps {
  markers: MapMarker[];
  center?: { latitud: number; longitud: number };
  zoom?: number;
  onMarkerPress?: (id: string) => void;
}

// Gualeguaychú: es donde están los reportes de los mocks
const DEFAULT_CENTER = { latitud: -33.0094, longitud: -58.5172 };

function buildHtml(
  markers: MapMarker[],
  center: { latitud: number; longitud: number },
  zoom: number,
) {
  // "<" se escapa para que ningún texto pueda cerrar el <script>
  const markersJson = JSON.stringify(markers).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>html, body, #map { height: 100%; margin: 0; }</style>
</head>
<body>
  <div id="map"></div>
  <script>
    var markers = ${markersJson};
    var map = L.map("map").setView([${center.latitud}, ${center.longitud}], ${zoom});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);

    markers.forEach(function (m) {
      var circle = L.circleMarker([m.latitud, m.longitud], {
        radius: 10,
        color: "#ffffff",
        weight: 2,
        fillColor: m.color,
        fillOpacity: 1
      }).addTo(map);

      var box = document.createElement("div");
      var title = document.createElement("strong");
      title.textContent = m.titulo;
      box.appendChild(title);
      if (m.detalle) {
        box.appendChild(document.createElement("br"));
        box.appendChild(document.createTextNode(m.detalle));
      }
      circle.bindPopup(box);

      circle.on("click", function () {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: "MARKER_PRESS", id: m.id })
        );
      });
    });
  </script>
</body>
</html>`;
}

export default function OsmMap({
  markers,
  center = DEFAULT_CENTER,
  zoom = 14,
  onMarkerPress,
}: OsmMapProps) {
  const html = useMemo(
    () => buildHtml(markers, center, zoom),
    [markers, center, zoom],
  );

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "MARKER_PRESS" && onMarkerPress) {
        onMarkerPress(msg.id);
      }
    } catch {
      // mensaje que no es nuestro: se ignora
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        originWhitelist={["*"]}
        source={{ html, baseUrl: "https://localhost/" }}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
});
