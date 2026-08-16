import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Project } from '../types';
import { lookupPostcode } from '../lib/api';
import { humanise, formatUseClass } from '../lib/format';

import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

interface PropertyMapProps {
  projects: Project[];
  projectsLoading: boolean;
  backendOffline: boolean;
}

interface ProjectCoord {
  project: Project;
  lat: number;
  lng: number;
}

const UK_CENTER: [number, number] = [52.5, -1.5];
const UK_ZOOM = 6;

// Postcode coordinates are immutable — cache at module level so tab
// switches don't re-geocode the whole portfolio.
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

/** Imperatively recentre the map when the target changes (react-leaflet
 *  ignores prop changes to center/zoom after the first render). */
function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 0.6 });
  }, [map, center, zoom]);
  return null;
}

export default function PropertyMap({ projects, projectsLoading, backendOffline }: PropertyMapProps) {
  const navigate = useNavigate();
  const [coords, setCoords] = useState<ProjectCoord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Yield first so state updates happen asynchronously to the effect body.
      await Promise.resolve();
      if (cancelled) return;

      const projectsWithPostcode = projects.filter((p) => p.address_postcode);
      if (projectsWithPostcode.length === 0) {
        setCoords([]);
        return;
      }

      setLoading(true);
      const results = await Promise.all(
        projectsWithPostcode.map(async (project): Promise<ProjectCoord | null> => {
          const pc = project.address_postcode!;
          const cached = geocodeCache.get(pc);
          if (cached !== undefined) {
            return cached ? { project, lat: cached.lat, lng: cached.lng } : null;
          }
          try {
            const lookup = await lookupPostcode(pc);
            const coord = { lat: lookup.latitude, lng: lookup.longitude };
            geocodeCache.set(pc, coord);
            return { project, ...coord };
          } catch {
            geocodeCache.set(pc, null);
            return null;
          }
        }),
      );

      if (!cancelled) {
        setCoords(results.filter((r): r is ProjectCoord => r !== null));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (coords.length > 0) {
      const avgLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
      const avgLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
      return [avgLat, avgLng];
    }
    return UK_CENTER;
  }, [coords]);

  const mapZoom = coords.length > 0 ? 10 : UK_ZOOM;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 600, margin: 0 }}>Property Map</h2>
        {loading && <span style={{ color: '#93c5fd', fontSize: 13 }}>Loading locations…</span>}
        <span style={{ color: '#94a3b8', fontSize: 13 }}>
          {coords.length} of {projects.length} mapped
        </span>
      </div>

      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e3a5f', height: 'calc(100dvh - 180px)' }}>
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <Recenter center={mapCenter} zoom={mapZoom} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {coords.map((c) => (
            <Marker key={c.project.id} position={[c.lat, c.lng]}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <strong>{c.project.address_raw}</strong>
                  <br />
                  <span>{formatUseClass(c.project.use_class)}</span>
                  <br />
                  <span>£{(c.project.price_pence / 100).toLocaleString()}</span>
                  <br />
                  <span>Stage: {humanise(c.project.stage)}</span>
                  <br />
                  <button
                    onClick={() => navigate(`/projects/${c.project.id}`)}
                    style={{
                      marginTop: 6,
                      padding: '3px 10px',
                      fontSize: 12,
                      background: '#2563eb',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    View project
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {backendOffline && (
        <p role="alert" style={{ color: '#f87171', fontSize: 13, marginTop: 12 }}>
          Can't reach the server — map data is unavailable until the connection recovers.
        </p>
      )}
      {!backendOffline && !projectsLoading && projects.length === 0 && (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
          No projects yet — add one from the New Project page and it will appear on the map.
        </p>
      )}
      {!backendOffline && projects.length > 0 && coords.length === 0 && !loading && (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
          No projects have postcodes yet. Open a project and use Edit to add one — it will appear here.
        </p>
      )}
    </div>
  );
}
