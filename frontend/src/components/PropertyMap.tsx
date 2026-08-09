import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Project } from '../types';
import { lookupPostcode } from '../lib/api';

import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

interface PropertyMapProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
}

interface ProjectCoord {
  project: Project;
  lat: number;
  lng: number;
}

const UK_CENTER: [number, number] = [52.5, -1.5];
const UK_ZOOM = 6;

export default function PropertyMap({ projects, selectedProject, onSelectProject }: PropertyMapProps) {
  const [coords, setCoords] = useState<ProjectCoord[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, { lat: number; lng: number } | null>>(new Map());

  const lookupCoords = useCallback(async () => {
    const projectsWithPostcode = projects.filter((p) => p.address_postcode);
    if (projectsWithPostcode.length === 0) {
      setCoords([]);
      return;
    }

    setLoading(true);
    const results: ProjectCoord[] = [];

    for (const project of projectsWithPostcode) {
      const pc = project.address_postcode!;
      const cached = cacheRef.current.get(pc);

      if (cached !== undefined) {
        if (cached) results.push({ project, lat: cached.lat, lng: cached.lng });
        continue;
      }

      try {
        const lookup = await lookupPostcode(pc);
        const coord = { lat: lookup.latitude, lng: lookup.longitude };
        cacheRef.current.set(pc, coord);
        results.push({ project, ...coord });
      } catch {
        cacheRef.current.set(pc, null);
      }
    }

    setCoords(results);
    setLoading(false);
  }, [projects]);

  useEffect(() => {
    lookupCoords();
  }, [lookupCoords]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (selectedProject) {
      const found = coords.find((c) => c.project.id === selectedProject.id);
      if (found) return [found.lat, found.lng];
    }
    if (coords.length > 0) {
      const avgLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
      const avgLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
      return [avgLat, avgLng];
    }
    return UK_CENTER;
  }, [coords, selectedProject]);

  const mapZoom = selectedProject && coords.find((c) => c.project.id === selectedProject.id) ? 14 : coords.length > 0 ? 10 : UK_ZOOM;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 600, margin: 0 }}>Property Map</h2>
        {loading && <span style={{ color: '#93c5fd', fontSize: 13 }}>Loading coordinates...</span>}
        <span style={{ color: '#64748b', fontSize: 13 }}>
          {coords.length} of {projects.length} mapped
        </span>
      </div>

      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e3a5f', height: 'calc(100vh - 180px)' }}>
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
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
                  <span>{c.project.use_class.replace(/_/g, ' ')}</span>
                  <br />
                  <span>£{(c.project.price_pence / 100).toLocaleString()}</span>
                  <br />
                  <span>Stage: {c.project.stage.replace(/_/g, ' ')}</span>
                  <br />
                  <button
                    onClick={() => onSelectProject(c.project)}
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
                    View Details
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {projects.length > 0 && coords.length === 0 && !loading && (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
          No projects have postcodes set. Add a postcode to a project to see it on the map.
        </p>
      )}
    </div>
  );
}
